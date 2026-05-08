/**
 * Project workspace — EDITING mode integration test (Phase 14.2).
 *
 * Mounts the full container with the actual edit/create body. Service
 * mocks at the boundary cover:
 *
 *   - Title-bar tabs IDENTITY and SCHEDULE
 *   - Identity / Schedule tab fields populate from the loaded project
 *   - SAVE in the footer calls saveProject.mutateAsync and the mode
 *     flips to viewing
 *   - DISCARD CHANGES resets dirty form state via the discardRef handle
 *   - CANCEL flips back to viewing without firing saveProject
 *   - Permission gate when projects.edit is denied — the body renders
 *     the access-denied placeholder
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

const saveProjectMutateAsync = vi.fn().mockResolvedValue(undefined);
const createProjectMutateAsync = vi.fn().mockResolvedValue({ id: "p-new", title: "x" });
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

// IdentityTab + ScheduleTab compose many fields with autocomplete +
// custom selects — we'll drive the form through the test handles the
// body renders in NODE_ENV=test, so we can stub these tabs with light-
// weight markers that confirm we landed on the right one.
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

const WINDOW_ID = "project-workspace:p-1";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p-1",
    title: "Driveway Sealing — Block 7",
    status: ProjectStatus.InProgress,
    companyId: "co-1",
    clientId: "client-1",
    teamMemberIds: ["u-1"],
    address: "123 Industry Way",
    latitude: 37.96,
    longitude: -121.29,
    startDate: new Date("2026-04-01"),
    endDate: new Date("2026-06-01"),
    projectDescription: "Phase 2 of the Greenway block",
    trade: "roofing",
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
  saveProjectMutateAsync.mockClear();
  createProjectMutateAsync.mockClear();
  archiveProjectMutate.mockClear();

  mockCan.mockReturnValue(true);
  mockProject.mockReturnValue({ data: makeProject(), isLoading: false });

  useWindowStore.setState({ windows: [], nextZIndex: 2000 });
  useWindowStore.setState((s) => ({
    windows: [
      ...s.windows,
      {
        id: WINDOW_ID,
        title: "Driveway Sealing",
        type: "project-workspace",
        isMinimized: false,
        position: { x: 100, y: 80 },
        size: { width: 1080, height: 760 },
        zIndex: 2000,
        meta: { projectId: "p-1", initialMode: "editing" },
      },
    ],
  }));
});

function renderContainer() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ProjectWorkspaceContainer windowId={WINDOW_ID} />
    </QueryClientProvider>,
  );
}

describe("Project workspace — editing mode integration", () => {
  it("renders both identity + schedule tab handles in the title bar", async () => {
    renderContainer();

    expect(await screen.findByTestId("identity-tab-stub")).toBeInTheDocument();
    // Both labels are rendered as buttons in the modal-tabs strip.
    expect(screen.getAllByText("tabs.identity").length).toBeGreaterThan(0);
    expect(screen.getAllByText("tabs.schedule").length).toBeGreaterThan(0);
  });

  it("switches to the schedule tab when the schedule label is clicked", async () => {
    renderContainer();
    await screen.findByTestId("identity-tab-stub");

    // Tab strip click — the modal-tabs strip uses buttons.
    const scheduleTabBtn = screen
      .getAllByText("tabs.schedule")
      .map((el) => el.closest("button"))
      .find((b): b is HTMLButtonElement => b !== null);
    expect(scheduleTabBtn).toBeDefined();
    fireEvent.click(scheduleTabBtn!);

    await waitFor(() => {
      expect(screen.getByTestId("schedule-tab-stub")).toBeInTheDocument();
    });
  });

  it("populates the form with the loaded project values", async () => {
    renderContainer();
    const titleInput = (await screen.findByTestId(
      "project-edit-create-body-test-title",
    )) as HTMLInputElement;
    expect(titleInput.value).toBe("Driveway Sealing — Block 7");
  });

  it("submits saveProject on form submit and flips back to viewing", async () => {
    renderContainer();
    await screen.findByTestId("identity-tab-stub");

    // SAVE button in the footer is type=submit + form="..." linking to
    // the composer's form. Click it; the form's onSubmit resolves the
    // mutation.
    const saveBtn = screen.getByRole("button", { name: "footer.save" });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(saveProjectMutateAsync).toHaveBeenCalledTimes(1);
    });
    // After save, container should switch the mode pill to viewing.
    // Identity stub disappears (no more edit-create body).
    await waitFor(() => {
      expect(screen.queryByTestId("identity-tab-stub")).not.toBeInTheDocument();
    });
  });

  it("CANCEL flips back to viewing without firing saveProject", async () => {
    renderContainer();
    await screen.findByTestId("identity-tab-stub");

    const cancelBtn = screen.getByRole("button", { name: "footer.cancel" });
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(screen.queryByTestId("identity-tab-stub")).not.toBeInTheDocument();
    });
    expect(saveProjectMutateAsync).not.toHaveBeenCalled();
  });

  it("DISCARD CHANGES resets dirty form state without flipping mode", async () => {
    renderContainer();
    const titleInput = (await screen.findByTestId(
      "project-edit-create-body-test-title",
    )) as HTMLInputElement;

    // Mark form dirty.
    fireEvent.change(titleInput, { target: { value: "DIRTY VALUE" } });
    expect(titleInput.value).toBe("DIRTY VALUE");

    const discardBtn = screen.getByRole("button", { name: "footer.discard" });
    fireEvent.click(discardBtn);

    // Reset to original.
    await waitFor(() => {
      expect(titleInput.value).toBe("Driveway Sealing — Block 7");
    });
    // Mode is still editing.
    expect(screen.getByTestId("identity-tab-stub")).toBeInTheDocument();
  });

  it("renders the permission-denied state when projects.edit is denied", async () => {
    mockCan.mockImplementation((perm: string) => perm !== "projects.edit");
    renderContainer();

    expect(
      await screen.findByTestId("project-edit-create-body-denied"),
    ).toBeInTheDocument();
    // The form must NOT render under denial.
    expect(
      screen.queryByTestId("project-edit-create-form"),
    ).not.toBeInTheDocument();
  });
});
