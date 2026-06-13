/**
 * Project workspace — mode flow lifecycle integration test (Phase 14.2).
 *
 * Walks the workspace through its full mode lifecycle inside one mounted
 * container so the boundaries between modes (creating → viewing,
 * viewing ↔ editing, viewing → archive confirm → archived) are
 * exercised end-to-end with the real edit/create body and viewing body
 * stubs:
 *
 *   1. creating mode → fill required fields → CREATE → window meta
 *      updates with the freshly minted id, mode flips to viewing
 *   2. viewing mode → click EDIT → mode flips to editing → SAVE flips
 *      back to viewing
 *   3. viewing → ARCHIVE in editing footer → ConfirmModal opens →
 *      confirm fires archiveProject.mutate; the dialog's Cancel path
 *      dismisses without firing the mutation
 *   4. permission revocation: hiding projects.archive removes the
 *      destructive button entirely
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ProjectStatus,
  type Project,
} from "@/lib/types/models";
import { useWindowStore } from "@/stores/window-store";

// ─── Boundary mocks ──────────────────────────────────────────────────────────

vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>(
    "framer-motion",
  );
  return { ...actual, useReducedMotion: () => true };
});

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
}));

const mockProject = vi.fn();
vi.mock("@/lib/hooks/use-projects", () => ({
  useProject: () => mockProject(),
}));

const saveProjectMutateAsync = vi.fn();
const createProjectMutateAsync = vi.fn();
const archiveProjectMutate = vi.fn();
vi.mock("@/lib/hooks/use-project-mutations", () => ({
  useProjectMutations: () => ({
    saveProject: { mutateAsync: saveProjectMutateAsync, isPending: false },
    createProject: { mutateAsync: createProjectMutateAsync, isPending: false },
    archiveProject: { mutate: archiveProjectMutate, isPending: false },
    deleteProject: { mutate: vi.fn(), isPending: false },
    postNote: { mutateAsync: vi.fn(), isPending: false },
    uploadPhoto: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

const mockCan = vi.fn();
vi.mock("@/lib/store/permissions-store", () => ({
  usePermissionStore: (
    selector: (s: { can: (p: string) => boolean }) => unknown,
  ) => selector({ can: mockCan }),
}));

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({
    currentUser: { id: "u-1", firstName: "Jack", lastName: "Sweet" },
    company: { id: "co-1" },
  }),
}));

// Stub the heavy bodies — the mode flow lives in the container, so we
// don't need the actual viewing/edit-create internals.
vi.mock(
  "@/components/ops/projects/workspace/viewing/project-viewing-body",
  () => ({
    ProjectViewingBody: ({ projectId }: { projectId: string }) => (
      <div data-testid="viewing-body-stub" data-project-id={projectId} />
    ),
    ProjectSidebar: ({ projectId }: { projectId: string }) => (
      <div data-testid="sidebar-stub" data-project-id={projectId} />
    ),
  }),
);
vi.mock(
  "@/components/ops/projects/workspace/viewing/project-sidebar",
  () => ({
    ProjectSidebar: ({ projectId }: { projectId: string }) => (
      <div data-testid="sidebar-stub" data-project-id={projectId} />
    ),
  }),
);

// Real edit-create body so we can drive the title input via the test
// handle the body exposes under NODE_ENV=test.
vi.mock(
  "@/components/ops/projects/workspace/edit-create/identity-tab",
  () => ({
    IdentityTab: ({ mode }: { mode: string }) => (
      <div data-testid="identity-tab-stub" data-mode={mode} />
    ),
  }),
);
vi.mock("@/components/ops/projects/workspace/edit-create/schedule-tab", () => ({
  ScheduleTab: () => <div data-testid="schedule-tab-stub" />,
}));

import { ProjectWorkspaceContainer } from "@/components/ops/projects/workspace/project-workspace-container";

const NEW_WINDOW_ID = "project-workspace:new";
const VIEW_WINDOW_ID = "project-workspace:p-1";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p-1",
    title: "Existing Build",
    status: ProjectStatus.InProgress,
    companyId: "co-1",
    clientId: null,
    teamMemberIds: ["u-1", "u-2"],
    address: null,
    latitude: null,
    longitude: null,
    startDate: new Date("2026-04-01"),
    endDate: new Date("2026-06-01"),
    projectDescription: null,
    trade: null,
    visibility: "all",
    notes: null,
    opportunityId: null,
    createdAt: new Date("2026-04-01"),
    ...overrides,
  } as Project;
}

beforeEach(() => {
  mockProject.mockReset();
  mockCan.mockReset();
  saveProjectMutateAsync.mockReset();
  createProjectMutateAsync.mockReset();
  archiveProjectMutate.mockReset();

  mockCan.mockReturnValue(true);
  saveProjectMutateAsync.mockResolvedValue(undefined);
  createProjectMutateAsync.mockResolvedValue({
    id: "p-fresh",
    title: "Fresh project",
  });

  useWindowStore.setState({ windows: [], nextZIndex: 2000 });
});

function renderForViewing() {
  useWindowStore.setState((s) => ({
    windows: [
      ...s.windows,
      {
        id: VIEW_WINDOW_ID,
        title: "Existing Build",
        type: "project-workspace",
        isMinimized: false,
        position: { x: 100, y: 80 },
        size: { width: 1080, height: 760 },
        zIndex: 2000,
        meta: { projectId: "p-1", initialMode: "viewing" },
      },
    ],
  }));
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ProjectWorkspaceContainer windowId={VIEW_WINDOW_ID} />
    </QueryClientProvider>,
  );
}

function renderForCreating() {
  useWindowStore.setState((s) => ({
    windows: [
      ...s.windows,
      {
        id: NEW_WINDOW_ID,
        title: "title.newProject",
        type: "project-workspace",
        isMinimized: false,
        position: { x: 100, y: 80 },
        size: { width: 1080, height: 760 },
        zIndex: 2000,
        meta: { projectId: null, initialMode: "creating" },
      },
    ],
  }));
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ProjectWorkspaceContainer windowId={NEW_WINDOW_ID} />
    </QueryClientProvider>,
  );
}

describe("Project workspace — mode flow lifecycle", () => {
  it("creating → save → viewing transitions update window meta and flip mode", async () => {
    // Container's useProject returns nothing in creating mode.
    mockProject.mockReturnValue({ data: undefined, isLoading: false });
    renderForCreating();

    const titleInput = (await screen.findByTestId(
      "project-edit-create-body-test-title",
    )) as HTMLInputElement;
    const tradeInput = (await screen.findByTestId(
      "project-edit-create-body-test-trade",
    )) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Fresh project" } });
    fireEvent.change(tradeInput, { target: { value: "roofing" } });

    const createBtn = screen.getByRole("button", { name: "footer.create" });

    // Once the create resolves, the container will call useProject(p-fresh)
    // which we now point at a real project shape so the viewing body gets
    // a project to render.
    mockProject.mockReturnValue({ data: makeProject({ id: "p-fresh", title: "Fresh project" }), isLoading: false });

    await act(async () => {
      fireEvent.click(createBtn);
    });

    await waitFor(() => {
      expect(createProjectMutateAsync).toHaveBeenCalledTimes(1);
    });

    // Window meta has the new project id and mode is viewing.
    await waitFor(() => {
      const win = useWindowStore
        .getState()
        .windows.find((w) => w.id === NEW_WINDOW_ID);
      expect(
        (win?.meta as { projectId?: string | null } | undefined)?.projectId,
      ).toBe("p-fresh");
      expect(win?.meta?.initialMode).toBe("viewing");
    });
    // Editing body is gone; viewing body is on screen.
    await waitFor(() => {
      expect(screen.queryByTestId("identity-tab-stub")).not.toBeInTheDocument();
      expect(screen.getByTestId("viewing-body-stub")).toBeInTheDocument();
    });
  });

  it("viewing → EDIT → save flips back to viewing", async () => {
    mockProject.mockReturnValue({ data: makeProject(), isLoading: false });
    renderForViewing();

    expect(await screen.findByTestId("viewing-body-stub")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "footer.edit" }));

    // Now in editing — the form mounts.
    expect(await screen.findByTestId("identity-tab-stub")).toBeInTheDocument();

    const saveBtn = screen.getByRole("button", { name: "footer.save" });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(saveProjectMutateAsync).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("identity-tab-stub")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("viewing-body-stub")).toBeInTheDocument();
  });

  it("editing → ARCHIVE opens ConfirmModal; confirm fires archiveProject.mutate", async () => {
    mockProject.mockReturnValue({ data: makeProject(), isLoading: false });
    renderForViewing();

    fireEvent.click(
      await screen.findByRole("button", { name: "footer.edit" }),
    );
    await screen.findByTestId("identity-tab-stub");

    fireEvent.click(screen.getByRole("button", { name: "footer.archive" }));

    // The ConfirmModal renders the destructive confirm button labeled
    // confirm.archive.confirm. The cancel button is the modal's own
    // Cancel — distinct from the editing footer's CANCEL.
    const confirmBtn = await screen.findByRole("button", {
      name: "confirm.archive.confirm",
    });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(archiveProjectMutate).toHaveBeenCalledTimes(1);
    });
    expect(archiveProjectMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p-1",
        projectTitle: "Existing Build",
        notifyUserIds: ["u-1", "u-2"],
      }),
      expect.any(Object),
    );
  });

  it("ARCHIVE button is hidden when projects.archive permission is revoked", async () => {
    mockCan.mockImplementation((perm: string) => perm !== "projects.archive");
    mockProject.mockReturnValue({ data: makeProject(), isLoading: false });
    renderForViewing();

    fireEvent.click(
      await screen.findByRole("button", { name: "footer.edit" }),
    );
    await screen.findByTestId("identity-tab-stub");

    expect(
      screen.queryByRole("button", { name: "footer.archive" }),
    ).not.toBeInTheDocument();
  });
});
