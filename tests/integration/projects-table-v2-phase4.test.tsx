import { describe, expect, it, vi, beforeEach } from "vitest";
import * as React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { ProjectStatus } from "@/lib/types/models";
import type { ProjectTableRow, ProjectTableViewDefinition } from "@/lib/types/project-table";
import type {
  ProjectTablePhoto,
  UploadProjectTablePhotoParams,
} from "@/lib/api/services/project-table-photo-service";
import { ProjectTableMutationError } from "@/lib/api/services/project-table-service";
import { ProjectsTableShell } from "@/app/(dashboard)/projects/_components/table-v2/projects-table-shell";

const {
  openProjectWindow,
  assignTeamMemberMock,
  removeTeamMemberMock,
  createFirstTaskMock,
  useProjectTableTeamMock,
  teamState,
  teamConflictsState,
  authState,
  fetchProjectPhotosMock,
  uploadProjectPhotoMock,
  deleteProjectPhotoMock,
  photoState,
  tableRowsQueryKey,
  bulkUpdateProjectsMock,
  fetchCompanyTeamMembersForBulkMock,
  fetchProjectTasksForBulkMock,
  analyticsTrackMock,
  dispatchProjectAssignmentMock,
  createSystemEventMock,
  showUndoToastMock,
} = vi.hoisted(() => ({
  openProjectWindow: vi.fn(),
  showUndoToastMock: vi.fn(),
  assignTeamMemberMock: vi.fn(),
  removeTeamMemberMock: vi.fn(),
  createFirstTaskMock: vi.fn(),
  useProjectTableTeamMock: vi.fn(),
  teamState: {
    assignedMembers: [] as Array<Record<string, unknown>>,
    availableMembers: [] as Array<Record<string, unknown>>,
    tasks: [] as Array<Record<string, unknown>>,
  },
  teamConflictsState: {
    data: [] as Array<{
      date: Date;
      memberName: string;
      memberId: string;
      projectTitle: string;
      projectId: string;
      taskColor: string;
    }>,
  },
  authState: {
    company: { id: "co-1" },
    currentUser: { id: "user-1" },
  },
  fetchProjectPhotosMock: vi.fn(),
  uploadProjectPhotoMock: vi.fn(),
  deleteProjectPhotoMock: vi.fn(),
  photoState: {
    photos: [] as ProjectTablePhoto[],
  },
  tableRowsQueryKey: ["projects", "tableRows", { test: "phase4-cell-photos" }] as const,
  bulkUpdateProjectsMock: vi.fn(),
  fetchCompanyTeamMembersForBulkMock: vi.fn(),
  fetchProjectTasksForBulkMock: vi.fn(),
  analyticsTrackMock: vi.fn(),
  dispatchProjectAssignmentMock: vi.fn(),
  createSystemEventMock: vi.fn(),
}));

const dictionary: Record<string, string> = {
  "table.toolbar.searchPlaceholder": "Search projects...",
  "table.toolbar.rows": "{count} / {total} rows",
  "table.column.select": "Select",
  "table.column.name": "Name",
  "table.column.status": "Status",
  "table.column.team": "Team",
  "table.column.endDate": "End",
  "table.column.photos": "Photos",
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
  "table.bulk.undoTitle": "// BULK CHANGE SAVED",
  "table.bulk.undoBody": "{count} projects updated.",
  "table.cell.team.title": "// TEAM - {project}",
  "table.cell.team.triggerLabel": "Team - {project} - {count} assigned",
  "table.cell.team.assigned": "ASSIGNED",
  "table.cell.team.available": "AVAILABLE",
  "table.cell.team.search": "Search team members...",
  "table.cell.team.taskSearch": "Search tasks...",
  "table.cell.team.assignToTasks": "Assign to tasks",
  "table.cell.team.noTasks": "No tasks to assign",
  "table.cell.team.createFirstTask": "Create first task",
  "table.cell.team.createTaskPlaceholder": "Task name",
  "table.cell.team.createTaskRequired": "Task name required",
  "table.cell.team.selectTask": "Select at least one task.",
  "table.cell.team.removeFromAll": "Remove from all",
  "table.cell.team.removeFromAllMember": "Remove {member} from all",
  "table.cell.team.assign": "Assign",
  "table.cell.team.readOnly": "// READ-ONLY - no team permission",
  "table.cell.team.error": "// TEAM UPDATE FAILED",
  "table.cell.team.emptyAvailable": "No active crew available.",
  conflict: "Double-booked · {project} · {when}",
  "table.cell.photos.title": "// PHOTOS - {project}",
  "table.cell.photos.triggerLabel": "Photos - {project} - {count}",
  "table.cell.photos.drop": "Drop photos here",
  "table.cell.photos.select": "Select photos",
  "table.cell.photos.uploading": "Uploading...",
  "table.cell.photos.uploadFailed": "// ERROR - UPLOAD FAILED",
  "table.cell.photos.deleteFailed": "// ERROR - DELETE FAILED",
  "table.cell.photos.delete": "Delete photo",
  "table.cell.photos.empty": "—",
  "table.cell.photos.thumbnail": "Project photo {index}",
  "detail.project": "Project",
  "cancel": "Cancel",
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
    id: "view-all-active",
    name: "All Active",
    icon: null,
    permissionKey: null,
    columns: ["name", "team", "photos"],
    filters: {},
    sort: [],
    density: "comfortable",
    zoomLevel: 1,
    isDefault: true,
    sortPosition: 0,
    updatedAt: "2026-05-13T00:00:00Z",
  },
  {
    id: "view-estimated",
    name: "Estimated",
    icon: null,
    permissionKey: null,
    columns: ["name", "team", "photos"],
    filters: { status: "estimated" },
    sort: [],
    density: "comfortable",
    zoomLevel: 1,
    isDefault: false,
    sortPosition: 1,
    updatedAt: "2026-05-13T00:00:00Z",
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
      teamMemberIds: ["u-1"],
      startDate: null,
      endDate: null,
      duration: null,
      progress: null,
      nextTask: null,
      taskCount: 3,
      taskCompletedCount: 1,
      daysInStatus: null,
      estimateTotal: null,
      invoiceTotal: null,
      paidTotal: null,
      value: null,
      projectCost: null,
      margin: null,
      photoCount: 2,
      updatedAt: "2026-05-13T00:00:00Z",
      statusVersion: 1,
    },
  ];
}

function createBulkRows(): ProjectTableRow[] {
  const [base] = createRows();
  return [
    {
      ...base,
      id: "p-1",
      title: "Deck rebuild",
      status: ProjectStatus.InProgress,
      rawStatus: "in_progress",
      teamMemberIds: ["u-1"],
      taskCount: 2,
      taskCompletedCount: 0,
      photoCount: 0,
      updatedAt: "2026-05-13T00:00:00Z",
    },
    {
      ...base,
      id: "p-2",
      title: "Fence repair",
      status: ProjectStatus.Accepted,
      rawStatus: "accepted",
      teamMemberIds: [],
      endDate: "2026-05-20",
      taskCount: 1,
      taskCompletedCount: 0,
      photoCount: 0,
      updatedAt: "2026-05-13T00:10:00Z",
    },
    {
      ...base,
      id: "p-hidden",
      title: "Hidden estimate",
      status: ProjectStatus.Estimated,
      rawStatus: "estimated",
      teamMemberIds: [],
      taskCount: 1,
      taskCompletedCount: 0,
      photoCount: 0,
      updatedAt: "2026-05-13T00:20:00Z",
    },
  ];
}

type InfiniteRowsData = {
  pages: Array<{ rows: ProjectTableRow[]; count: number; nextPage: number | null }>;
  pageParams: number[];
};

function createPhotos(): ProjectTablePhoto[] {
  return [
    {
      id: "photo-1",
      projectId: "p-1",
      companyId: "co-1",
      url: "https://storage.test/p-1/photo-1.jpg",
      thumbnailUrl: "https://storage.test/p-1/photo-1-thumb.jpg",
      source: "other",
      uploadedBy: "user-1",
      createdAt: "2026-05-13T01:00:00Z",
      deletedAt: null,
      isClientVisible: false,
    },
    {
      id: "photo-2",
      projectId: "p-1",
      companyId: "co-1",
      url: "https://storage.test/p-1/photo-2.jpg",
      thumbnailUrl: "https://storage.test/p-1/photo-2-thumb.jpg",
      source: "other",
      uploadedBy: "user-1",
      createdAt: "2026-05-13T00:30:00Z",
      deletedAt: null,
      isClientVisible: false,
    },
  ];
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function seedTableRows(queryClient: QueryClient, nextRows = rows) {
  queryClient.setQueryData<InfiniteRowsData>(tableRowsQueryKey, {
    pages: [{ rows: nextRows, count: nextRows.length, nextPage: null }],
    pageParams: [0],
  });
}

function renderProjectsTable(queryClient = makeQueryClient()) {
  seedTableRows(queryClient);
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ProjectsTableShell />
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

function getSelectInput(container: HTMLElement, rowId: string) {
  const input = container.querySelector<HTMLButtonElement>(
    `[data-project-table-row-id="${rowId}"][data-project-table-column-id="select"] [role="checkbox"]`,
  );
  if (!input) throw new Error(`Missing select input for ${rowId}`);
  return input;
}

function getTableCell(container: HTMLElement, rowId: string, columnId: string) {
  const cell = container.querySelector<HTMLElement>(
    `[data-project-table-row-id="${rowId}"][data-project-table-column-id="${columnId}"]`,
  );
  if (!cell) throw new Error(`Missing ${columnId} cell for ${rowId}`);
  return cell;
}

async function selectProjectRows(container: HTMLElement, rowIds: string[]) {
  for (const rowId of rowIds) {
    fireEvent.click(getSelectInput(container, rowId));
  }
  await waitFor(() => {
    expect(screen.getByText(`// ${rowIds.length} SELECTED`)).toBeInTheDocument();
  });
}

function resetTeamState() {
  teamState.assignedMembers = [
    {
      id: "u-1",
      name: "Mara Silva",
      email: "mara@example.com",
      role: "crew",
      profileImageUrl: null,
      userColor: "#6F94B0",
    },
  ];
  teamState.availableMembers = [
    {
      id: "u-2",
      name: "Owen Vale",
      email: "owen@example.com",
      role: "operator",
      profileImageUrl: null,
      userColor: "#9DB582",
    },
  ];
  teamState.tasks = [
    {
      id: "task-1",
      title: "Frame inspection",
      status: "active",
      startDate: null,
      endDate: null,
      teamMemberIds: ["u-1"],
    },
    {
      id: "task-2",
      title: "Final walkthrough",
      status: "in_progress",
      startDate: null,
      endDate: null,
      teamMemberIds: [],
    },
    {
      id: "task-3",
      title: "Closeout packet",
      status: "completed",
      startDate: null,
      endDate: null,
      teamMemberIds: [],
    },
    {
      id: "task-4",
      title: "Cancelled task",
      status: "cancelled",
      startDate: null,
      endDate: null,
      teamMemberIds: [],
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

vi.mock("@/lib/hooks/use-team-conflicts", () => ({
  useTeamScheduleConflicts: () => ({ data: teamConflictsState.data }),
}));

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: (selector?: (state: typeof authState) => unknown) =>
    selector ? selector(authState) : authState,
}));

vi.mock("@/lib/analytics/analytics-service", () => ({
  analyticsService: {
    track: analyticsTrackMock,
  },
}));

vi.mock("@/lib/api/services/notification-dispatch", () => ({
  dispatchProjectAssignment: dispatchProjectAssignmentMock,
}));

vi.mock("@/lib/api/services/project-note-service", () => ({
  ProjectNoteService: {
    createSystemEvent: createSystemEventMock,
  },
}));

vi.mock("@/lib/api/services/project-table-photo-service", () => ({
  ProjectTablePhotoService: {
    fetchProjectPhotos: fetchProjectPhotosMock,
    uploadProjectPhoto: uploadProjectPhotoMock,
    deleteProjectPhoto: deleteProjectPhotoMock,
  },
}));

vi.mock("@/lib/api/services/project-table-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/services/project-table-service")>(
    "@/lib/api/services/project-table-service",
  );
  return {
    ...actual,
    ProjectTableService: {
      ...actual.ProjectTableService,
      bulkUpdateProjects: bulkUpdateProjectsMock,
    },
  };
});

vi.mock("@/lib/api/services/project-table-team-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/services/project-table-team-service")>(
    "@/lib/api/services/project-table-team-service",
  );
  return {
    ...actual,
    ProjectTableTeamService: {
      ...actual.ProjectTableTeamService,
      fetchCompanyTeamMembers: fetchCompanyTeamMembersForBulkMock,
      fetchProjectTasks: fetchProjectTasksForBulkMock,
    },
  };
});

vi.mock("@/components/ui/toast-undo", () => ({
  showUndoToast: showUndoToastMock,
}));

vi.mock("@/stores/window-store", () => ({
  useWindowStore: (selector: (state: { openProjectWindow: typeof openProjectWindow }) => unknown) =>
    selector({ openProjectWindow }),
}));

vi.mock("@/lib/hooks/projects-table/use-project-table-team", () => ({
  useProjectTableTeam: useProjectTableTeamMock,
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
      const [activeViewId, setActiveViewId] = ReactModule.useState("view-all-active");
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
  useProjectsTableData: (args: { search?: string; view?: ProjectTableViewDefinition | null }) => {
    const queryClient = useQueryClient();
    React.useSyncExternalStore(
      (onStoreChange) =>
        queryClient.getQueryCache().subscribe((event) => {
          const queryKey = event.query.queryKey;
          if (Array.isArray(queryKey) && queryKey[0] === "projects" && queryKey[1] === "tableRows") {
            onStoreChange();
          }
        }),
      () => queryClient.getQueryState(tableRowsQueryKey)?.dataUpdatedAt ?? 0,
      () => 0,
    );
    const data = queryClient.getQueryData<InfiniteRowsData>(tableRowsQueryKey);
    const sourceRows = data?.pages.flatMap((page) => page.rows) ?? rows;
    const search = args.search?.trim().toLowerCase() ?? "";
    const tableRows = sourceRows
      .filter((row) => {
        if (args.view?.id !== "view-estimated") return true;
        return row.status === ProjectStatus.Estimated;
      })
      .filter((row) => {
        if (!search) return true;
        return row.title.toLowerCase().includes(search);
      });

    return {
      rows: tableRows,
      totalCount: data?.pages[0]?.count ?? tableRows.length,
      isLoading: false,
      isError: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    };
  },
}));

describe("Projects table v2 Phase 4 team cell", () => {
  beforeEach(() => {
    rows = createRows();
    resetTeamState();
    teamConflictsState.data = [];
    openProjectWindow.mockReset();
    assignTeamMemberMock.mockReset();
    removeTeamMemberMock.mockReset();
    createFirstTaskMock.mockReset();
    createFirstTaskMock.mockResolvedValue({
      taskId: "task-new",
      updatedAt: "2026-05-13T01:00:00Z",
    });
    assignTeamMemberMock.mockResolvedValue({ updatedAt: "2026-05-13T01:00:00Z" });
    removeTeamMemberMock.mockResolvedValue({ updatedAt: "2026-05-13T01:00:00Z" });
    authState.company = { id: "co-1" };
    authState.currentUser = { id: "user-1" };
    photoState.photos = createPhotos();
    fetchProjectPhotosMock.mockReset();
    uploadProjectPhotoMock.mockReset();
    deleteProjectPhotoMock.mockReset();
    analyticsTrackMock.mockReset();
    dispatchProjectAssignmentMock.mockReset();
    createSystemEventMock.mockReset();
    fetchProjectPhotosMock.mockImplementation(async () => photoState.photos);
    uploadProjectPhotoMock.mockImplementation(async (params: UploadProjectTablePhotoParams) => {
      const createdPhoto: ProjectTablePhoto = {
        id: `photo-${photoState.photos.length + 1}`,
        projectId: params.projectId,
        companyId: params.companyId,
        url: `https://storage.test/${params.projectId}/${params.file.name}`,
        thumbnailUrl: `https://storage.test/${params.projectId}/${params.file.name}`,
        source: "other",
        uploadedBy: params.uploadedBy,
        createdAt: "2026-05-13T02:00:00Z",
        deletedAt: null,
        isClientVisible: false,
      };
      photoState.photos = [createdPhoto, ...photoState.photos];
      return {
        objectPath: `${params.companyId}/${params.projectId}/${params.file.name}`,
        photo: createdPhoto,
      };
    });
    deleteProjectPhotoMock.mockImplementation(async (photoId: string) => {
      photoState.photos = photoState.photos.filter((photo) => photo.id !== photoId);
    });
    useProjectTableTeamMock.mockImplementation(() => ({
      teamMembersQuery: {
        data: [...teamState.assignedMembers, ...teamState.availableMembers],
        isLoading: false,
        isError: false,
        error: null,
      },
      tasksQuery: {
        data: teamState.tasks,
        isLoading: false,
        isError: false,
        error: null,
      },
      assignedMembers: teamState.assignedMembers,
      availableMembers: teamState.availableMembers,
      assignTeamMember: {
        mutateAsync: assignTeamMemberMock,
        isPending: false,
      },
      removeTeamMember: {
        mutateAsync: removeTeamMemberMock,
        isPending: false,
      },
      createFirstTask: {
        mutateAsync: createFirstTaskMock,
        isPending: false,
      },
    }));
  });

  it("renders the All Active team cell as an avatar/count control", async () => {
    renderProjectsTable();

    expect(screen.getByRole("button", { name: "All Active" })).toBeInTheDocument();
    const trigger = screen.getByRole("button", {
      name: "Team - Deck rebuild - 1 assigned",
    });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(await within(trigger).findByText("MS")).toBeInTheDocument();
    expect(within(trigger).getByText("1")).toBeInTheDocument();
  });

  it("assigns a member to every active task when toggled on", async () => {
    const user = userEvent.setup();
    renderProjectsTable();

    await user.click(screen.getByRole("button", { name: "Team - Deck rebuild - 1 assigned" }));
    await user.click(await screen.findByText("Owen Vale"));

    expect(assignTeamMemberMock).toHaveBeenCalledWith({
      userId: "u-2",
      taskIds: ["task-1", "task-2"],
    });
  });

  it("removes a member from all tasks when toggled off", async () => {
    const user = userEvent.setup();
    renderProjectsTable();

    await user.click(screen.getByRole("button", { name: "Team - Deck rebuild - 1 assigned" }));
    await user.click(await screen.findByText("Mara Silva"));

    expect(removeTeamMemberMock).toHaveBeenCalledWith({
      userId: "u-1",
      taskIds: null,
    });
  });

  it("blocks assignment with a notice when the project has no active task", async () => {
    const user = userEvent.setup();
    teamState.tasks = [];
    rows = rows.map((row) => ({ ...row, taskCount: 0, taskCompletedCount: 0 }));

    renderProjectsTable();

    await user.click(screen.getByRole("button", { name: "Team - Deck rebuild - 1 assigned" }));
    expect(await screen.findByText("No tasks to assign")).toBeInTheDocument();

    await user.click(screen.getByText("Owen Vale"));
    expect(assignTeamMemberMock).not.toHaveBeenCalled();
  });

  it("surfaces a dictionary-backed read-only message when assignment is denied", async () => {
    const user = userEvent.setup();
    assignTeamMemberMock.mockRejectedValue(
      new ProjectTableMutationError("permission denied", "42501"),
    );

    renderProjectsTable();

    await user.click(screen.getByRole("button", { name: "Team - Deck rebuild - 1 assigned" }));
    await user.click(await screen.findByText("Owen Vale"));

    expect(await screen.findByText("// READ-ONLY - no team permission")).toBeInTheDocument();
  });

  it("keeps table focus navigation isolated while the team popover is active", async () => {
    const user = userEvent.setup();
    renderProjectsTable();

    await user.click(screen.getByRole("button", { name: "Team - Deck rebuild - 1 assigned" }));
    const search = await screen.findByPlaceholderText("Search team members...");
    await user.click(search);
    await user.keyboard("{ArrowDown} ");

    expect(search).toHaveFocus();
    expect(screen.getByRole("dialog", { name: "// TEAM - Deck rebuild" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "// TEAM - Deck rebuild" })).not.toBeInTheDocument(),
    );
  });

  it("shows an inline conflict advisory for a double-booked member", async () => {
    const user = userEvent.setup();
    teamConflictsState.data = [
      {
        date: new Date("2026-06-09T00:00:00Z"),
        memberName: "Owen Vale",
        memberId: "u-2",
        projectTitle: "Cedar & Main",
        projectId: "p-9",
        taskColor: "#000000",
      },
    ];

    renderProjectsTable();

    await user.click(screen.getByRole("button", { name: "Team - Deck rebuild - 1 assigned" }));
    expect(await screen.findByText(/double-booked · cedar & main/i)).toBeInTheDocument();
  });
});

describe("Projects table v2 Phase 4 photos cell", () => {
  beforeEach(() => {
    rows = createRows();
    resetTeamState();
    authState.company = { id: "co-1" };
    authState.currentUser = { id: "user-1" };
    photoState.photos = createPhotos();
    fetchProjectPhotosMock.mockReset();
    uploadProjectPhotoMock.mockReset();
    deleteProjectPhotoMock.mockReset();
    analyticsTrackMock.mockReset();
    dispatchProjectAssignmentMock.mockReset();
    createSystemEventMock.mockReset();
    fetchProjectPhotosMock.mockImplementation(async () => photoState.photos);
    uploadProjectPhotoMock.mockImplementation(async (params: UploadProjectTablePhotoParams) => {
      const createdPhoto: ProjectTablePhoto = {
        id: `photo-${photoState.photos.length + 1}`,
        projectId: params.projectId,
        companyId: params.companyId,
        url: `https://storage.test/${params.projectId}/${params.file.name}`,
        thumbnailUrl: `https://storage.test/${params.projectId}/${params.file.name}`,
        source: "other",
        uploadedBy: params.uploadedBy,
        createdAt: "2026-05-13T02:00:00Z",
        deletedAt: null,
        isClientVisible: false,
      };
      photoState.photos = [createdPhoto, ...photoState.photos];
      return {
        objectPath: `${params.companyId}/${params.projectId}/${params.file.name}`,
        photo: createdPhoto,
      };
    });
    deleteProjectPhotoMock.mockImplementation(async (photoId: string) => {
      photoState.photos = photoState.photos.filter((photo) => photo.id !== photoId);
    });
  });

  it("shows the photo count and opens a thumbnail popover", async () => {
    const user = userEvent.setup();
    renderProjectsTable();

    const trigger = screen.getByRole("button", { name: "Photos - Deck rebuild - 2" });
    expect(within(trigger).getByText("2")).toBeInTheDocument();

    await user.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "// PHOTOS - Deck rebuild" });
    expect(dialog).toHaveClass("glass-dense");
    expect(within(dialog).getByAltText("Project photo 1")).toBeInTheDocument();
    expect(within(dialog).getByAltText("Project photo 2")).toBeInTheDocument();
    expect(within(dialog).getByText("Drop photos here")).toBeInTheDocument();
  });

  it("uploads from the drop zone and the file picker through the photo upload hook", async () => {
    const user = userEvent.setup();
    renderProjectsTable();

    await user.click(screen.getByRole("button", { name: "Photos - Deck rebuild - 2" }));
    const dialog = await screen.findByRole("dialog", { name: "// PHOTOS - Deck rebuild" });
    const dropZone = within(dialog).getByText("Drop photos here").closest("label");
    const input = within(dialog).getByLabelText("Select photos") as HTMLInputElement;

    const droppedFile = new File(["dropped"], "dropped-roof.jpg", { type: "image/jpeg" });
    fireEvent.drop(dropZone!, { dataTransfer: { files: [droppedFile] } });

    await waitFor(() =>
      expect(uploadProjectPhotoMock).toHaveBeenCalledWith({
        companyId: "co-1",
        projectId: "p-1",
        uploadedBy: "user-1",
        file: droppedFile,
      }),
    );

    uploadProjectPhotoMock.mockClear();
    const pickedFile = new File(["picked"], "picked-roof.png", { type: "image/png" });
    await user.upload(input, pickedFile);

    await waitFor(() =>
      expect(uploadProjectPhotoMock).toHaveBeenCalledWith({
        companyId: "co-1",
        projectId: "p-1",
        uploadedBy: "user-1",
        file: pickedFile,
      }),
    );
  });

  it("increments the cached photo count after a successful upload", async () => {
    const user = userEvent.setup();
    const queryClient = makeQueryClient();
    renderProjectsTable(queryClient);

    await user.click(screen.getByRole("button", { name: "Photos - Deck rebuild - 2" }));
    const dialog = await screen.findByRole("dialog", { name: "// PHOTOS - Deck rebuild" });
    const input = within(dialog).getByLabelText("Select photos") as HTMLInputElement;

    await user.upload(input, new File(["photo"], "new-roof.webp", { type: "image/webp" }));

    await waitFor(() => {
      const tableRows = queryClient.getQueryData<InfiniteRowsData>(tableRowsQueryKey);
      expect(tableRows?.pages[0]?.rows[0]?.photoCount).toBe(3);
    });
    expect(await screen.findByRole("button", { name: "Photos - Deck rebuild - 3" })).toBeInTheDocument();
  });

  it("shows the dictionary-backed upload failure message", async () => {
    const user = userEvent.setup();
    uploadProjectPhotoMock.mockRejectedValueOnce(new Error("storage denied"));
    renderProjectsTable();

    await user.click(screen.getByRole("button", { name: "Photos - Deck rebuild - 2" }));
    const dialog = await screen.findByRole("dialog", { name: "// PHOTOS - Deck rebuild" });
    const input = within(dialog).getByLabelText("Select photos") as HTMLInputElement;

    await user.upload(input, new File(["photo"], "failed-roof.jpg", { type: "image/jpeg" }));

    expect(await within(dialog).findByText("// ERROR - UPLOAD FAILED")).toBeInTheDocument();
  });

  it("soft-deletes a photo and decrements the cached count", async () => {
    const user = userEvent.setup();
    const queryClient = makeQueryClient();
    renderProjectsTable(queryClient);

    await user.click(screen.getByRole("button", { name: "Photos - Deck rebuild - 2" }));
    const dialog = await screen.findByRole("dialog", { name: "// PHOTOS - Deck rebuild" });

    await user.click(within(dialog).getAllByRole("button", { name: "Delete photo" })[0]);

    await waitFor(() => expect(deleteProjectPhotoMock).toHaveBeenCalledWith("photo-1"));
    await waitFor(() => {
      const tableRows = queryClient.getQueryData<InfiniteRowsData>(tableRowsQueryKey);
      expect(tableRows?.pages[0]?.rows[0]?.photoCount).toBe(1);
    });
    expect(await screen.findByRole("button", { name: "Photos - Deck rebuild - 1" })).toBeInTheDocument();
  });

  it("keeps table focus navigation isolated while the photos popover is active", async () => {
    const user = userEvent.setup();
    renderProjectsTable();

    await user.click(screen.getByRole("button", { name: "Photos - Deck rebuild - 2" }));
    const dialog = await screen.findByRole("dialog", { name: "// PHOTOS - Deck rebuild" });
    const selectButton = within(dialog).getByRole("button", { name: "Select photos" });
    selectButton.focus();

    await user.keyboard("{ArrowRight}{ArrowDown}{Enter} ");

    expect(selectButton).toHaveFocus();
    expect(screen.getByRole("dialog", { name: "// PHOTOS - Deck rebuild" })).toBeInTheDocument();
  });
});

describe("Projects table v2 Phase 4 bulk bar", () => {
  beforeEach(() => {
    rows = createBulkRows();
    resetTeamState();
    authState.company = { id: "co-1" };
    authState.currentUser = { id: "user-1" };
    bulkUpdateProjectsMock.mockReset();
    fetchCompanyTeamMembersForBulkMock.mockReset();
    fetchProjectTasksForBulkMock.mockReset();
    analyticsTrackMock.mockReset();
    dispatchProjectAssignmentMock.mockReset();
    createSystemEventMock.mockReset();
    bulkUpdateProjectsMock.mockResolvedValue({
      success: [],
      failed: [],
      successCount: 0,
      failedCount: 0,
    });
    fetchCompanyTeamMembersForBulkMock.mockResolvedValue([
      {
        id: "u-2",
        name: "Owen Vale",
        email: "owen@example.com",
        role: "operator",
        profileImageUrl: null,
        userColor: "#9DB582",
      },
    ]);
    fetchProjectTasksForBulkMock.mockImplementation(async (projectId: string) =>
      projectId === "p-1"
        ? [
            {
              id: "task-p1-active",
              title: "Frame inspection",
              status: "active",
              startDate: null,
              endDate: null,
              teamMemberIds: [],
            },
            {
              id: "task-p1-complete",
              title: "Closeout packet",
              status: "completed",
              startDate: null,
              endDate: null,
              teamMemberIds: [],
            },
          ]
        : [
            {
              id: "task-p2-active",
              title: "Fence install",
              status: "in_progress",
              startDate: null,
              endDate: null,
              teamMemberIds: [],
            },
          ],
    );
  });

  it("renders selection count from visible selected rows and prunes hidden IDs before bulk status", async () => {
    const { container, queryClient } = renderProjectsTable();
    await selectProjectRows(container, ["p-1", "p-2"]);

    act(() => {
      seedTableRows(queryClient, [rows[0]]);
    });

    await waitFor(() => {
      expect(screen.getByText("// 1 SELECTED")).toBeInTheDocument();
    });

    bulkUpdateProjectsMock.mockResolvedValueOnce({
      success: [
        {
          projectId: "p-1",
          action: "status",
          updatedAt: "2026-05-13T01:00:00Z",
          statusVersion: 2,
        },
      ],
      failed: [],
      successCount: 1,
      failedCount: 0,
    });

    await userEvent.click(screen.getByRole("button", { name: "Archive" }));

    expect(bulkUpdateProjectsMock).toHaveBeenCalledWith({
      operations: [
        {
          action: "status",
          projectId: "p-1",
          status: ProjectStatus.Archived,
          expectedUpdatedAt: "2026-05-13T00:00:00Z",
          expectedStatusVersion: 1,
        },
      ],
    });
  });

  it("clears selection when search, sort, or view filters reset the table", async () => {
    const { container } = renderProjectsTable();

    await selectProjectRows(container, ["p-1"]);
    fireEvent.change(screen.getByPlaceholderText("Search projects..."), {
      target: { value: "Deck" },
    });
    await waitFor(() => {
      expect(screen.queryByText("// 1 SELECTED")).not.toBeInTheDocument();
    });

    await selectProjectRows(container, ["p-1"]);
    fireEvent.click(screen.getAllByRole("button", { name: /^Name$/ })[0]);
    await waitFor(() => {
      expect(screen.queryByText("// 1 SELECTED")).not.toBeInTheDocument();
    });

    await selectProjectRows(container, ["p-1"]);
    fireEvent.click(screen.getByRole("button", { name: /Estimated/ }));
    await waitFor(() => {
      expect(screen.queryByText("// 1 SELECTED")).not.toBeInTheDocument();
    });
  });

  it("runs status, archive, and due-date bulk operations against selected visible rows", async () => {
    const user = userEvent.setup();
    const { container } = renderProjectsTable();

    bulkUpdateProjectsMock.mockResolvedValue({
      success: [
        {
          projectId: "p-1",
          action: "status",
          updatedAt: "2026-05-13T01:00:00Z",
          statusVersion: 2,
        },
        {
          projectId: "p-2",
          action: "status",
          updatedAt: "2026-05-13T01:00:00Z",
          statusVersion: 2,
        },
      ],
      failed: [],
      successCount: 2,
      failedCount: 0,
    });

    await selectProjectRows(container, ["p-1", "p-2"]);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Change status" }),
      ProjectStatus.Completed,
    );
    await user.click(screen.getByRole("button", { name: "Change status" }));

    expect(bulkUpdateProjectsMock).toHaveBeenLastCalledWith({
      operations: [
        {
          action: "status",
          projectId: "p-1",
          status: ProjectStatus.Completed,
          expectedUpdatedAt: "2026-05-13T00:00:00Z",
          expectedStatusVersion: 1,
        },
        {
          action: "status",
          projectId: "p-2",
          status: ProjectStatus.Completed,
          expectedUpdatedAt: "2026-05-13T00:10:00Z",
          expectedStatusVersion: 1,
        },
      ],
    });

    bulkUpdateProjectsMock.mockResolvedValueOnce({
      success: [
        {
          projectId: "p-1",
          action: "status",
          updatedAt: "2026-05-13T01:00:00Z",
          statusVersion: 3,
        },
      ],
      failed: [],
      successCount: 1,
      failedCount: 0,
    });
    await selectProjectRows(container, ["p-1"]);
    await user.click(screen.getByRole("button", { name: "Archive" }));
    expect(bulkUpdateProjectsMock).toHaveBeenLastCalledWith({
      operations: [
        {
          action: "status",
          projectId: "p-1",
          status: ProjectStatus.Archived,
          expectedUpdatedAt: "2026-05-13T01:00:00Z",
          expectedStatusVersion: 2,
        },
      ],
    });

    bulkUpdateProjectsMock.mockResolvedValueOnce({
      success: [{ projectId: "p-1", action: "date", updatedAt: "2026-05-13T02:00:00Z" }],
      failed: [],
      successCount: 1,
      failedCount: 0,
    });
    await selectProjectRows(container, ["p-1"]);
    fireEvent.change(screen.getByLabelText("Set due date"), {
      target: { value: "2026-06-15" },
    });
    await user.click(screen.getByRole("button", { name: "Set due date" }));

    expect(bulkUpdateProjectsMock).toHaveBeenLastCalledWith({
      operations: [
        {
          action: "date",
          projectId: "p-1",
          field: "end_date",
          value: "2026-06-15",
          expectedUpdatedAt: "2026-05-13T01:00:00Z",
        },
      ],
    });
  });

  it("requires a deliberate task scope before bulk assign and sends all active task IDs", async () => {
    const user = userEvent.setup();
    const { container } = renderProjectsTable();

    await selectProjectRows(container, ["p-1", "p-2"]);
    await user.click(screen.getByRole("button", { name: "Assign to" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Assign to" }), "u-2");
    await user.click(screen.getAllByRole("button", { name: "Assign to" })[1]);

    expect(await screen.findByText("Select task scope.")).toBeInTheDocument();
    expect(bulkUpdateProjectsMock).not.toHaveBeenCalled();

    bulkUpdateProjectsMock.mockResolvedValueOnce({
      success: [
        { projectId: "p-1", action: "assign_team", updatedAt: "2026-05-13T01:00:00Z" },
        { projectId: "p-2", action: "assign_team", updatedAt: "2026-05-13T01:00:00Z" },
      ],
      failed: [],
      successCount: 2,
      failedCount: 0,
    });

    await user.click(screen.getByRole("checkbox", { name: "Assign to all active tasks" }));
    await user.click(screen.getAllByRole("button", { name: "Assign to" })[1]);

    await waitFor(() => {
      expect(bulkUpdateProjectsMock).toHaveBeenCalledWith({
        operations: [
          {
            action: "assign_team",
            projectId: "p-1",
            userId: "u-2",
            taskIds: ["task-p1-active"],
            expectedUpdatedAt: "2026-05-13T00:00:00Z",
          },
          {
            action: "assign_team",
            projectId: "p-2",
            userId: "u-2",
            taskIds: ["task-p2-active"],
            expectedUpdatedAt: "2026-05-13T00:10:00Z",
          },
        ],
      });
    });
  });

  it("keeps selection on partial failure, retries failed rows, and discard clears selection", async () => {
    const user = userEvent.setup();
    const { container } = renderProjectsTable();

    bulkUpdateProjectsMock
      .mockResolvedValueOnce({
        success: [
          {
            projectId: "p-1",
            action: "status",
            updatedAt: "2026-05-13T01:00:00Z",
            statusVersion: 2,
          },
        ],
        failed: [
          {
            projectId: "p-2",
            action: "status",
            code: "P0001",
            message: "project conflict",
          },
        ],
        successCount: 1,
        failedCount: 1,
      })
      .mockResolvedValueOnce({
        success: [
          {
            projectId: "p-2",
            action: "status",
            updatedAt: "2026-05-13T01:10:00Z",
            statusVersion: 2,
          },
        ],
        failed: [],
        successCount: 1,
        failedCount: 0,
      });

    await selectProjectRows(container, ["p-1", "p-2"]);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Change status" }),
      ProjectStatus.Completed,
    );
    await user.click(screen.getByRole("button", { name: "Change status" }));

    expect(await screen.findByText("Updated 1 of 2. 1 failed.")).toBeInTheDocument();
    expect(screen.getByText("// 2 SELECTED")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(bulkUpdateProjectsMock).toHaveBeenLastCalledWith({
        operations: [
          {
            action: "status",
            projectId: "p-2",
            status: ProjectStatus.Completed,
            expectedUpdatedAt: "2026-05-13T00:10:00Z",
            expectedStatusVersion: 1,
          },
        ],
      });
    });
    await waitFor(() => {
      expect(screen.queryByText("// 2 SELECTED")).not.toBeInTheDocument();
    });

    bulkUpdateProjectsMock.mockResolvedValueOnce({
      success: [],
      failed: [
        {
          projectId: "p-1",
          action: "status",
          code: "P0001",
          message: "project conflict",
        },
      ],
      successCount: 0,
      failedCount: 1,
    });

    await selectProjectRows(container, ["p-1"]);
    await user.click(screen.getByRole("button", { name: "Archive" }));
    expect(await screen.findByText("Updated 0 of 1. 1 failed.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => {
      expect(screen.queryByText("// 1 SELECTED")).not.toBeInTheDocument();
    });
  });

  it("undoes a successful bulk status change with one bulk undo service call", async () => {
    const user = userEvent.setup();
    const { container } = renderProjectsTable();

    bulkUpdateProjectsMock
      .mockResolvedValueOnce({
        success: [
          {
            projectId: "p-1",
            action: "status",
            updatedAt: "2026-05-13T01:00:00Z",
            statusVersion: 2,
          },
          {
            projectId: "p-2",
            action: "status",
            updatedAt: "2026-05-13T01:00:10Z",
            statusVersion: 2,
          },
        ],
        failed: [],
        successCount: 2,
        failedCount: 0,
      })
      .mockResolvedValueOnce({
        success: [
          {
            projectId: "p-1",
            action: "status",
            updatedAt: "2026-05-13T02:00:00Z",
            statusVersion: 3,
          },
          {
            projectId: "p-2",
            action: "status",
            updatedAt: "2026-05-13T02:00:10Z",
            statusVersion: 3,
          },
        ],
        failed: [],
        successCount: 2,
        failedCount: 0,
      });

    await selectProjectRows(container, ["p-1", "p-2"]);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Change status" }),
      ProjectStatus.Completed,
    );
    await user.click(screen.getByRole("button", { name: "Change status" }));

    await waitFor(() => expect(showUndoToastMock).toHaveBeenCalled());
    const undoToast = showUndoToastMock.mock.calls.at(-1)![0];
    expect(undoToast.title).toBe("// BULK CHANGE SAVED");
    expect(undoToast.description).toBe("2 projects updated.");
    await undoToast.onUndo();

    await waitFor(() => {
      expect(bulkUpdateProjectsMock).toHaveBeenLastCalledWith({
        operations: [
          {
            action: "status",
            projectId: "p-1",
            status: ProjectStatus.InProgress,
            expectedUpdatedAt: "2026-05-13T01:00:00Z",
            expectedStatusVersion: 2,
          },
          {
            action: "status",
            projectId: "p-2",
            status: ProjectStatus.Accepted,
            expectedUpdatedAt: "2026-05-13T01:00:10Z",
            expectedStatusVersion: 2,
          },
        ],
      });
    });
    expect(bulkUpdateProjectsMock).toHaveBeenCalledTimes(2);
  });

  it("uses Cmd/Ctrl+A for visible rows only and Escape clears selection when not editing", async () => {
    const user = userEvent.setup();
    const { container } = renderProjectsTable();

    await user.type(screen.getByPlaceholderText("Search projects..."), "Deck");
    await waitFor(() => {
      expect(
        container.querySelector(
          '[data-project-table-row-id="p-2"][data-project-table-column-id="select"]',
        ),
      ).not.toBeInTheDocument();
    });
    const selectCell = getTableCell(container, "p-1", "select");
    act(() => {
      selectCell.focus();
    });
    act(() => {
      fireEvent.keyDown(selectCell, { key: "a", metaKey: true });
    });

    expect(await screen.findByText("// 1 SELECTED")).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(selectCell, { key: "Escape" });
    });
    await waitFor(() => {
      expect(screen.queryByText("// 1 SELECTED")).not.toBeInTheDocument();
    });
  });
});
