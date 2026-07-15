import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { ProjectStatus } from "@/lib/types/models";
import type {
  ProjectTableRow,
  ProjectTableSort,
  ProjectTableViewDefinition,
} from "@/lib/types/project-table";
import { ProjectsTableShell } from "@/app/(dashboard)/projects/_components/table-v2/projects-table-shell";

const dictionary: Record<string, string> = {
  "table.toolbar.searchPlaceholder": "Search projects...",
  "table.toolbar.rows": "{count} / {total} rows",
  "table.gridLabel": "Projects table",
  "table.density.label": "Density",
  "table.density.compact": "Compact",
  "table.density.comfortable": "Comfortable",
  "table.density.spacious": "Spacious",
  "table.density.zoom": "Zoom",
  "table.density.errorPermissionDenied": "Permission required to save density.",
  "table.density.errorGeneric": "Density update failed.",
  "table.column.select": "Select",
  "table.column.name": "Name",
  "table.column.status": "Status",
  "table.column.client": "Client",
  "table.column.team": "Team",
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
  "table.views.newView": "+ New view",
  "table.views.createTitle": "// NEW VIEW",
  "table.views.nameLabel": "View name",
  "table.views.namePlaceholder": "Crew closeout",
  "table.views.startingPointLabel": "Start from",
  "table.views.cloneCurrent": "Clone current view",
  "table.views.blankDefault": "Blank default",
  "table.views.create": "Create",
  "table.views.cancel": "Cancel",
  "table.views.settingsLabel": "View actions",
  "table.views.rename": "Rename",
  "table.views.renameTitle": "// RENAME VIEW",
  "table.views.renameAction": "Save name",
  "table.views.duplicate": "Duplicate",
  "table.views.duplicateTitle": "// DUPLICATE VIEW",
  "table.views.duplicateNameTemplate": "{name} copy",
  "table.views.shareWithTeam": "Share with team",
  "table.views.save": "Save view",
  "table.views.archive": "Archive",
  "table.views.resetToDefaults": "Reset to defaults",
  "table.views.archiveTitle": "// ARCHIVE VIEW",
  "table.views.archiveBody": "Archive this personal view. The table falls back to the next view.",
  "table.views.archiveConfirm": "Archive",
  "table.views.resetTitle": "// RESET VIEW",
  "table.views.resetBody": "Restore the seeded columns, filters, and sort.",
  "table.views.resetConfirm": "Reset",
  "table.views.personalBadge": "Personal",
  "table.views.companyBadge": "Company",
  "table.views.validationRequired": "View name required.",
  "table.views.validationTooLong": "Keep view names at 60 characters or fewer.",
  "table.views.errorDuplicateName": "View name already exists.",
  "table.views.errorPermissionDenied": "Permission required to manage this view.",
  "table.views.errorGeneric": "View update failed.",
  "table.views.loading": "// LOADING VIEWS",
  "table.views.error": "// VIEW LOAD FAILED",
  "table.views.empty": "// NO SAVED VIEWS",
  "table.bulk.selectedCount": "// {count} SELECTED",
  "table.bulk.changeStatus": "Change status",
  "table.bulk.assignTo": "Assign to",
  "table.bulk.assignAllActiveTasks": "Assign to all active tasks",
  "table.bulk.assignTaskRequired": "Select task scope.",
  "table.bulk.setDueDate": "Set due date",
  "table.bulk.archive": "Archive",
  "table.bulk.clear": "Clear",
  "table.bulk.confirmLarge": "Apply this to {count} projects?",
  "table.bulk.partialFailure": "Updated {success} of {total}. {failed} failed.",
  "table.bulk.retry": "Retry",
  "table.bulk.discard": "Discard",
  "status.rfq": "RFQ",
  "status.estimated": "Estimated",
  "status.accepted": "Accepted",
  "status.inProgress": "In Progress",
  "status.completed": "Completed",
  "status.closed": "Closed",
  "detail.project": "Project",
};

const routerPush = vi.fn();
const routerReplace = vi.fn();
let pathname = "/projects";
let searchParams = new URLSearchParams();

const rows: ProjectTableRow[] = [
  {
    id: "project-1",
    companyId: "company-1",
    title: "Deck rebuild",
    status: ProjectStatus.InProgress,
    rawStatus: "in_progress",
    clientId: "client-1",
    clientName: "Riley Home",
    clientEmail: null,
    clientPhone: null,
    address: null,
    teamMemberIds: ["user-1"],
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

const baseViews: ProjectTableViewDefinition[] = [
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
    updatedAt: "2026-05-14T00:00:00Z",
    ownerType: "user",
    ownerId: "user-1",
  },
  {
    id: "view-personal",
    name: "Crew Closeout",
    icon: null,
    permissionKey: null,
    columns: ["name", "status", "client"],
    filters: {},
    sort: [],
    density: "comfortable",
    zoomLevel: 1,
    isDefault: false,
    sortPosition: 1,
    updatedAt: "2026-05-14T00:01:00Z",
    ownerType: "user",
    ownerId: "user-1",
  },
  {
    id: "view-company",
    name: "Company Dispatch",
    icon: null,
    permissionKey: null,
    columns: ["name", "status", "client"],
    filters: {},
    sort: [],
    density: "comfortable",
    zoomLevel: 1,
    isDefault: false,
    sortPosition: 2,
    updatedAt: "2026-05-14T00:02:00Z",
    ownerType: "company",
    ownerId: "company-1",
  },
];

let viewListState: {
  data: ProjectTableViewDefinition[] | undefined;
  isLoading: boolean;
  isError: boolean;
};
let canManageViews = false;
// The name-based "My Active Work" auto-default is gone; landing on a concrete
// view is now expressed via the per-user default-view preference. These tests
// were written against "view-active" as the default, so pin the preference to it.
let defaultViewPreference: string | null = "view-active";
let tableDataCalls: Array<{
  view: ProjectTableViewDefinition | null;
  search: string;
  sorting: ProjectTableSort[];
}> = [];

const createPersonalView = vi.fn();
const duplicateView = vi.fn();
const renameView = vi.fn();
const archiveView = vi.fn();
const resetDefaultView = vi.fn();
const shareViewWithTeam = vi.fn();
const updateViewDefinition = vi.fn();

function mutation<TVariables, TResult = ProjectTableViewDefinition>(
  mutateAsync: (variables: TVariables) => Promise<TResult>,
) {
  return {
    mutateAsync,
    isPending: false,
    errorCode: null,
    reset: vi.fn(),
  };
}

function cloneViews() {
  return baseViews.map((view) => ({
    ...view,
    columns: [...view.columns],
    sort: [...view.sort],
  }));
}

function setViewList(data: ProjectTableViewDefinition[] | undefined) {
  viewListState = {
    data,
    isLoading: false,
    isError: false,
  };
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function setSearch(value: string) {
  searchParams = new URLSearchParams(value);
}

function setJsonSearchParam(key: string, value: unknown) {
  const next = new URLSearchParams(searchParams.toString());
  next.set(key, JSON.stringify(value));
  setSearch(next.toString());
}

function latestTableDataCall() {
  const call = tableDataCalls.at(-1);
  if (!call) throw new Error("Expected useProjectsTableData to be called");
  return call;
}

function getSelectInput(container: HTMLElement, rowId: string) {
  const input = container.querySelector<HTMLButtonElement>(
    `[data-project-table-row-id="${rowId}"][data-project-table-column-id="select"] [role="checkbox"]`,
  );
  if (!input) throw new Error(`Missing select input for ${rowId}`);
  return input;
}

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string) => dictionary[key] ?? key,
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
  usePathname: () => pathname,
  useSearchParams: () => searchParams,
}));

vi.mock("@/stores/preferences-store", () => ({
  usePreferencesStore: Object.assign(
    (
      selector: (state: {
        projectsDefaultViewId: string | null;
        setProjectsDefaultViewId: (viewId: string | null) => void;
      }) => unknown,
    ) => selector({ projectsDefaultViewId: defaultViewPreference, setProjectsDefaultViewId: () => {} }),
    {
      getState: () => ({
        projectsDefaultViewId: defaultViewPreference,
        setProjectsDefaultViewId: () => {},
      }),
    },
  ),
}));

vi.mock("@/stores/window-store", () => ({
  useWindowStore: (selector: (state: { openProjectWindow: () => void }) => unknown) =>
    selector({ openProjectWindow: vi.fn() }),
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
  }),
}));

vi.mock("@/lib/hooks/projects-table/use-project-views-list", () => ({
  useProjectViewsList: () => ({
    ...viewListState,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/lib/hooks/projects-table/use-project-view-actions", () => ({
  useProjectViewActions: () => ({
    canShareViews: canManageViews,
    createPersonalView: mutation(createPersonalView),
    duplicateView: mutation(duplicateView),
    renameView: mutation(renameView),
    archiveView: mutation(archiveView),
    resetDefaultView: mutation(resetDefaultView),
    shareViewWithTeam: mutation(shareViewWithTeam),
    updateViewDefinition: mutation(updateViewDefinition),
  }),
}));

vi.mock("@/lib/hooks/projects-table/use-projects-table-data", () => ({
  useProjectsTableData: (args: {
    view: ProjectTableViewDefinition | null;
    search: string;
    sorting: ProjectTableSort[];
  }) => {
    tableDataCalls.push({
      view: args.view,
      search: args.search,
      sorting: args.sorting,
    });

    return {
      rows,
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

function renderShell() {
  const queryClient = makeQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectsTableShell />
    </QueryClientProvider>,
  );
}

async function openSettings(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: dictionary["table.views.settingsLabel"] }));
}

async function switchToView(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: new RegExp(name, "i") }));
}

describe("Projects table v2 saved-view management", () => {
  beforeEach(() => {
    canManageViews = false;
    defaultViewPreference = "view-active";
    pathname = "/projects";
    setSearch("");
    tableDataCalls = [];
    routerPush.mockReset();
    routerReplace.mockReset();
    window.localStorage.clear();
    setViewList(cloneViews());
    vi.clearAllMocks();

    createPersonalView.mockImplementation(async ({ name }) => ({
      ...baseViews[1],
      id: "view-created",
      name,
      ownerType: "user",
      ownerId: "user-1",
      isDefault: false,
    }));
    duplicateView.mockImplementation(async ({ name, sourceView }) => ({
      ...sourceView,
      id: "view-duplicate",
      name,
      ownerType: "user",
      ownerId: "user-1",
      isDefault: false,
    }));
    renameView.mockImplementation(async ({ viewId, name }) => ({
      ...(viewListState.data?.find((view) => view.id === viewId) ?? baseViews[0]),
      name,
    }));
    archiveView.mockImplementation(async ({ viewId }) => ({
      ...(viewListState.data?.find((view) => view.id === viewId) ?? baseViews[1]),
      isArchived: true,
    }));
    resetDefaultView.mockImplementation(async ({ viewId }) => ({
      ...(viewListState.data?.find((view) => view.id === viewId) ?? baseViews[0]),
    }));
    shareViewWithTeam.mockImplementation(async ({ viewId }) => ({
      ...(viewListState.data?.find((view) => view.id === viewId) ?? baseViews[0]),
      ownerType: "company",
      ownerId: "company-1",
    }));
    updateViewDefinition.mockImplementation(async ({ viewId, definition }) => ({
      ...(viewListState.data?.find((view) => view.id === viewId) ?? baseViews[0]),
      ...definition,
      updatedAt: "2026-05-14T00:04:00Z",
    }));
  });

  it("uses saved view sort on initial load and lets explicit sort changes wait for Save view", async () => {
    const user = userEvent.setup();
    setViewList([
      {
        ...baseViews[0],
        sort: [{ field: "end_date", direction: "asc" }],
      },
      ...cloneViews().slice(1),
    ]);

    renderShell();

    await waitFor(() => {
      expect(latestTableDataCall().sorting).toEqual([{ field: "end_date", direction: "asc" }]);
    });

    await user.click(screen.getAllByRole("button", { name: dictionary["table.column.name"] })[0]);

    await waitFor(() => {
      expect(latestTableDataCall().sorting).toEqual([{ field: "name", direction: "asc" }]);
    });
    expect(updateViewDefinition).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: dictionary["table.views.save"] }));

    await waitFor(() => {
      expect(updateViewDefinition).toHaveBeenCalledWith({
        viewId: "view-active",
        definition: expect.objectContaining({
          columns: ["name", "status", "client", "end_date", "next_task", "progress"],
          filters: {},
          sort: [{ field: "name", direction: "asc" }],
        }),
      });
    });
  });

  it("uses URL sort overrides without mutating the saved view until explicit save", async () => {
    const savedSort = [{ field: "end_date", direction: "asc" }] satisfies ProjectTableSort[];
    setViewList([
      {
        ...baseViews[0],
        sort: savedSort,
      },
      ...cloneViews().slice(1),
    ]);
    setSearch("sort=name:desc");

    renderShell();

    await waitFor(() => {
      expect(latestTableDataCall().sorting).toEqual([{ field: "name", direction: "desc" }]);
    });
    expect(updateViewDefinition).not.toHaveBeenCalled();
    expect(viewListState.data?.[0]?.sort).toEqual(savedSort);

    await userEvent.click(screen.getByRole("button", { name: dictionary["table.views.save"] }));

    await waitFor(() => {
      expect(updateViewDefinition).toHaveBeenCalledWith({
        viewId: "view-active",
        definition: expect.objectContaining({
          sort: [{ field: "name", direction: "desc" }],
        }),
      });
    });
  });

  it("layers URL filters over saved filters and shares the pending effective definition", async () => {
    const savedFilter = { field: "status", op: "not_in", value: ["closed", "archived"] };
    const urlFilter = { field: "status", op: "in", value: ["accepted"] };
    canManageViews = true;
    setViewList([
      {
        ...baseViews[0],
        filters: savedFilter,
      },
      ...cloneViews().slice(1),
    ]);
    setJsonSearchParam("filter", urlFilter);

    const user = userEvent.setup();
    renderShell();

    await waitFor(() => {
      expect(latestTableDataCall().view?.filters).toEqual({
        and: [savedFilter, urlFilter],
      });
    });
    expect(updateViewDefinition).not.toHaveBeenCalled();

    await openSettings(user);
    await user.click(screen.getByRole("menuitem", { name: dictionary["table.views.shareWithTeam"] }));

    await waitFor(() => {
      expect(updateViewDefinition).toHaveBeenCalledWith({
        viewId: "view-active",
        definition: expect.objectContaining({
          filters: { and: [savedFilter, urlFilter] },
        }),
      });
      expect(shareViewWithTeam).toHaveBeenCalledWith({ viewId: "view-active" });
    });
  });

  it("drops unknown saved column IDs at render and only writes sanitized columns on explicit save", async () => {
    const user = userEvent.setup();
    setViewList([
      {
        ...baseViews[0],
        columns: ["name", "ghost_column", "status"] as ProjectTableViewDefinition["columns"],
      },
      ...cloneViews().slice(1),
    ]);

    renderShell();

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: dictionary["table.column.name"] }).length).toBeGreaterThan(0);
    });
    expect(screen.getAllByRole("button", { name: dictionary["table.column.status"] }).length).toBeGreaterThan(0);
    expect(screen.queryByText("ghost_column")).not.toBeInTheDocument();
    expect(updateViewDefinition).not.toHaveBeenCalled();

    await user.click(screen.getAllByRole("button", { name: dictionary["table.column.name"] })[0]);
    await user.click(screen.getByRole("button", { name: dictionary["table.views.save"] }));

    await waitFor(() => {
      expect(updateViewDefinition).toHaveBeenCalledWith({
        viewId: "view-active",
        definition: expect.objectContaining({
          columns: ["name", "status"],
        }),
      });
    });
  });

  it("keeps Financial Overview absent when the server omits it and falls back from an inaccessible URL view", async () => {
    setSearch("view=view-financial");

    renderShell();

    expect(screen.queryByRole("button", { name: /Financial Overview/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /My Active Work/i })).toHaveClass("bg-surface-active");
    await waitFor(() => {
      expect(routerReplace).toHaveBeenCalledWith("/projects?view=view-active");
    });
  });

  it("clears selection when the URL view definition changes", async () => {
    const { container, rerender } = renderShell();

    fireEvent.click(getSelectInput(container, "project-1"));
    await waitFor(() => {
      expect(screen.getByText("// 1 SELECTED")).toBeInTheDocument();
    });

    setJsonSearchParam("filter", { field: "status", op: "in", value: ["accepted"] });
    rerender(
      <QueryClientProvider client={makeQueryClient()}>
        <ProjectsTableShell />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByText("// 1 SELECTED")).not.toBeInTheDocument();
    });
  });

  it("opens a dense create dialog and validates names before the service call", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: dictionary["table.views.newView"] }));

    const dialog = screen.getByRole("dialog", { name: dictionary["table.views.createTitle"] });
    expect(dialog).toHaveClass("glass-dense");

    await user.click(within(dialog).getByRole("button", { name: dictionary["table.views.create"] }));
    expect(await within(dialog).findByText(dictionary["table.views.validationRequired"])).toBeInTheDocument();
    expect(createPersonalView).not.toHaveBeenCalled();

    const nameInput = within(dialog).getByLabelText(dictionary["table.views.nameLabel"]);
    await user.type(nameInput, "A".repeat(61));
    await user.click(within(dialog).getByRole("button", { name: dictionary["table.views.create"] }));

    expect(await within(dialog).findByText(dictionary["table.views.validationTooLong"])).toBeInTheDocument();
    expect(createPersonalView).not.toHaveBeenCalled();
  });

  it("creates a new personal view from the dialog", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: dictionary["table.views.newView"] }));
    const dialog = screen.getByRole("dialog", { name: dictionary["table.views.createTitle"] });

    await user.type(within(dialog).getByLabelText(dictionary["table.views.nameLabel"]), "Install week");
    await user.click(within(dialog).getByRole("radio", { name: dictionary["table.views.cloneCurrent"] }));
    await user.click(within(dialog).getByRole("button", { name: dictionary["table.views.create"] }));

    await waitFor(() => {
      expect(createPersonalView).toHaveBeenCalledWith({
        name: "Install week",
        sourceView: expect.objectContaining({ id: "view-active" }),
      });
    });
  });

  it("duplicates the active view with a generated personal-view name", async () => {
    const user = userEvent.setup();
    renderShell();

    await openSettings(user);
    await user.click(screen.getByRole("menuitem", { name: dictionary["table.views.duplicate"] }));

    const dialog = screen.getByRole("dialog", { name: dictionary["table.views.duplicateTitle"] });
    expect(within(dialog).getByLabelText(dictionary["table.views.nameLabel"])).toHaveValue("My Active Work copy");

    await user.click(within(dialog).getByRole("button", { name: dictionary["table.views.create"] }));

    await waitFor(() => {
      expect(duplicateView).toHaveBeenCalledWith({
        name: "My Active Work copy",
        sourceView: expect.objectContaining({ id: "view-active" }),
      });
    });
  });

  it("renames the active view and updates the tab label", async () => {
    const user = userEvent.setup();
    renderShell();

    await switchToView(user, "Crew Closeout");
    await openSettings(user);
    await user.click(screen.getByRole("menuitem", { name: dictionary["table.views.rename"] }));

    const dialog = screen.getByRole("dialog", { name: dictionary["table.views.renameTitle"] });
    const input = within(dialog).getByLabelText(dictionary["table.views.nameLabel"]);
    await user.clear(input);
    await user.type(input, "Crew Ready");
    await user.click(within(dialog).getByRole("button", { name: dictionary["table.views.renameAction"] }));

    expect(await screen.findByRole("button", { name: /Crew Ready/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Crew Closeout/i })).not.toBeInTheDocument();
  });

  it("archives an active personal view after confirmation and falls back to the next view", async () => {
    const user = userEvent.setup();
    renderShell();

    await switchToView(user, "Crew Closeout");
    await openSettings(user);
    await user.click(screen.getByRole("menuitem", { name: dictionary["table.views.archive"] }));

    const dialog = screen.getByRole("alertdialog", { name: dictionary["table.views.archiveTitle"] });
    expect(within(dialog).getByText(dictionary["table.views.archiveBody"])).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: dictionary["table.views.archiveConfirm"] }));

    await waitFor(() => expect(archiveView).toHaveBeenCalledWith({ viewId: "view-personal" }));
    expect(screen.queryByRole("button", { name: /Crew Closeout/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /My Active Work/i })).toHaveClass("bg-surface-active");
  });

  it("shows default reset only for seeded views and hides share controls without manage permission", async () => {
    const user = userEvent.setup();
    renderShell();

    await openSettings(user);
    expect(screen.getByRole("menuitem", { name: dictionary["table.views.resetToDefaults"] })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: dictionary["table.views.shareWithTeam"] })).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    await switchToView(user, "Crew Closeout");
    await openSettings(user);
    expect(screen.queryByRole("menuitem", { name: dictionary["table.views.resetToDefaults"] })).not.toBeInTheDocument();
  });

  it("shows share controls for managers", async () => {
    const user = userEvent.setup();
    canManageViews = true;
    renderShell();

    await openSettings(user);

    expect(screen.getByRole("menuitem", { name: dictionary["table.views.shareWithTeam"] })).toBeInTheDocument();
  });

  it("renders duplicate-name and permission-denied errors from dictionary copy", async () => {
    const user = userEvent.setup();
    duplicateView.mockRejectedValueOnce({ code: "DUPLICATE_NAME" });
    renameView.mockRejectedValueOnce({ code: "PERMISSION_DENIED" });
    renderShell();

    await openSettings(user);
    await user.click(screen.getByRole("menuitem", { name: dictionary["table.views.duplicate"] }));
    let dialog = screen.getByRole("dialog", { name: dictionary["table.views.duplicateTitle"] });
    await user.click(within(dialog).getByRole("button", { name: dictionary["table.views.create"] }));

    expect(await within(dialog).findByText(dictionary["table.views.errorDuplicateName"])).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: dictionary["table.views.cancel"] }));
    await openSettings(user);
    await user.click(screen.getByRole("menuitem", { name: dictionary["table.views.rename"] }));
    dialog = screen.getByRole("dialog", { name: dictionary["table.views.renameTitle"] });
    await user.click(within(dialog).getByRole("button", { name: dictionary["table.views.renameAction"] }));

    expect(await within(dialog).findByText(dictionary["table.views.errorPermissionDenied"])).toBeInTheDocument();
  });

  it("renders dictionary-backed view loading, error, and empty states", () => {
    viewListState = { data: undefined, isLoading: true, isError: false };
    const { rerender } = render(<ProjectsTableShell />);
    expect(screen.getAllByText(dictionary["table.views.loading"]).length).toBeGreaterThan(0);

    viewListState = { data: undefined, isLoading: false, isError: true };
    rerender(<ProjectsTableShell />);
    expect(screen.getAllByText(dictionary["table.views.error"]).length).toBeGreaterThan(0);

    viewListState = { data: [], isLoading: false, isError: false };
    rerender(<ProjectsTableShell />);
    expect(screen.getAllByText(dictionary["table.views.empty"]).length).toBeGreaterThan(0);
  });

  it("persists compact, comfortable, and spacious density presets to the active view", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: dictionary["table.density.compact"] }));
    await waitFor(() => {
      expect(updateViewDefinition).toHaveBeenLastCalledWith({
        viewId: "view-active",
        definition: { density: "compact", zoomLevel: 0.85 },
      });
    });
    expect(screen.getByLabelText(dictionary["table.density.zoom"])).toHaveValue("85");

    await user.click(screen.getByRole("button", { name: dictionary["table.density.spacious"] }));
    await waitFor(() => {
      expect(updateViewDefinition).toHaveBeenLastCalledWith({
        viewId: "view-active",
        definition: { density: "spacious", zoomLevel: 1.25 },
      });
    });
    expect(screen.getByLabelText(dictionary["table.density.zoom"])).toHaveValue("125");

    await user.click(screen.getByRole("button", { name: dictionary["table.density.comfortable"] }));
    await waitFor(() => {
      expect(updateViewDefinition).toHaveBeenLastCalledWith({
        viewId: "view-active",
        definition: { density: "comfortable", zoomLevel: 1 },
      });
    });
    expect(screen.getByLabelText(dictionary["table.density.zoom"])).toHaveValue("100");
  });

  it("persists an editable numeric zoom percentage", async () => {
    const user = userEvent.setup();
    renderShell();

    const zoomInput = screen.getByLabelText(dictionary["table.density.zoom"]);
    await user.clear(zoomInput);
    await user.type(zoomInput, "112{enter}");

    await waitFor(() => {
      expect(updateViewDefinition).toHaveBeenLastCalledWith({
        viewId: "view-active",
        definition: { density: "comfortable", zoomLevel: 1.12 },
      });
    });
    expect(zoomInput).toHaveValue("112");
  });

  it("reverts density and shows dictionary copy when the active-view save is denied", async () => {
    const user = userEvent.setup();
    updateViewDefinition.mockRejectedValueOnce({ code: "PERMISSION_DENIED" });
    renderShell();

    await user.click(screen.getByRole("button", { name: dictionary["table.density.compact"] }));

    expect(await screen.findByText(dictionary["table.density.errorPermissionDenied"])).toBeInTheDocument();
    expect(screen.getByLabelText(dictionary["table.density.zoom"])).toHaveValue("100");
    expect(screen.getByRole("button", { name: dictionary["table.density.comfortable"] })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("persists table-focused keyboard density commands and snaps ctrl-wheel idle to a preset", async () => {
    renderShell();

    const grid = screen.getByRole("grid", { name: dictionary["table.gridLabel"] });
    grid.focus();

    fireEvent.keyDown(grid, { key: "+", metaKey: true });
    await waitFor(() => {
      expect(updateViewDefinition).toHaveBeenLastCalledWith({
        viewId: "view-active",
        definition: { density: "spacious", zoomLevel: 1.25 },
      });
    });

    updateViewDefinition.mockClear();
    fireEvent.keyDown(grid, { key: "0", metaKey: true });
    await waitFor(() => {
      expect(updateViewDefinition).toHaveBeenLastCalledWith({
        viewId: "view-active",
        definition: { density: "comfortable", zoomLevel: 1 },
      });
    });

    updateViewDefinition.mockClear();
    for (let index = 0; index < 7; index += 1) {
      fireEvent.wheel(grid, { ctrlKey: true, deltaY: -100 });
    }

    await waitFor(() => {
      expect(updateViewDefinition).toHaveBeenLastCalledWith({
        viewId: "view-active",
        definition: { density: "spacious", zoomLevel: 1.25 },
      });
    });
  });
});
