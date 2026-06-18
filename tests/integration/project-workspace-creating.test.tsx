/**
 * Project workspace — CREATING mode integration test (Phase 14.2).
 *
 * Mounts the container with mode=creating. Service-layer mocks cover:
 *
 *   - Form starts empty (title, trade, dates, etc.)
 *   - CREATE click without required fields rejects (mutation not called)
 *   - CREATE with required fields fires createProject.mutateAsync
 *   - On success, the container fires onProjectCreated synchronously
 *     (consumeProjectCreatedCallback) BEFORE updateWindowMeta swaps
 *     the window's projectId from "new" to the freshly minted id
 *   - Mode swaps from creating → viewing after success
 *   - Permission gate when projects.create is denied — body renders the
 *     access-denied placeholder
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

// In creating mode the container's useProject is gated off, but the
// edit-create body's useProject still runs with `undefined` projectId
// — return a noop result.
vi.mock("@/lib/hooks/use-projects", () => ({
  useProject: () => ({ data: undefined, isLoading: false }),
}));

const createProjectMutateAsync = vi.fn();
const saveProjectMutateAsync = vi.fn();
vi.mock("@/lib/hooks/use-project-mutations", () => ({
  useProjectMutations: () => ({
    saveProject: { mutateAsync: saveProjectMutateAsync, isPending: false },
    createProject: { mutateAsync: createProjectMutateAsync, isPending: false },
    archiveProject: { mutate: vi.fn(), isPending: false },
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

const WINDOW_ID = "project-workspace:new";

beforeEach(() => {
  mockCan.mockReset();
  createProjectMutateAsync.mockReset();
  saveProjectMutateAsync.mockReset();

  mockCan.mockReturnValue(true);
  // Successful create returns the freshly-minted project shape the
  // container expects.
  createProjectMutateAsync.mockResolvedValue({
    id: "p-fresh",
    title: "Fresh project",
  });

  useWindowStore.setState({ windows: [], nextZIndex: 2000 });
  useWindowStore.setState((s) => ({
    windows: [
      ...s.windows,
      {
        id: WINDOW_ID,
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

describe("Project workspace — creating mode integration", () => {
  it("renders an empty composer with CREATE primary footer button", async () => {
    renderContainer();

    expect(await screen.findByTestId("identity-tab-stub")).toBeInTheDocument();
    expect(screen.getByTestId("identity-tab-stub")).toHaveAttribute(
      "data-mode",
      "creating",
    );
    expect(
      screen.getByRole("button", { name: "footer.create" }),
    ).toBeInTheDocument();

    const titleInput = (await screen.findByTestId(
      "project-edit-create-body-test-title",
    )) as HTMLInputElement;
    expect(titleInput.value).toBe("");
  });

  it("rejects submit when the required trade is missing (creating-mode gate)", async () => {
    renderContainer();
    await screen.findByTestId("identity-tab-stub");

    const createBtn = screen.getByRole("button", { name: "footer.create" });
    await act(async () => {
      fireEvent.click(createBtn);
    });

    // Title is OPTIONAL now (blank ⇒ auto-named from the address). Trade is the
    // sole creating-mode required field — its gate fires inside react-hook-form's
    // resolver, so the mutation must NOT be called.
    expect(createProjectMutateAsync).not.toHaveBeenCalled();
  });

  it("auto-names by default — submits titleIsAuto=true with no title when only the required trade is set", async () => {
    renderContainer();

    const tradeInput = (await screen.findByTestId(
      "project-edit-create-body-test-trade",
    )) as HTMLInputElement;

    // The operator never types a name in the common path — the DB trigger
    // derives it from the address (titleIsAuto=true, title omitted).
    fireEvent.change(tradeInput, { target: { value: "roofing" } });

    const createBtn = screen.getByRole("button", { name: "footer.create" });
    await act(async () => {
      fireEvent.click(createBtn);
    });

    await waitFor(() => {
      expect(createProjectMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(createProjectMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        title: undefined,
        titleIsAuto: true,
        trade: "roofing",
      }),
    );
  });

  it("freezes a hand-typed name when the operator opens rename (titleIsAuto=false)", async () => {
    renderContainer();

    const titleInput = (await screen.findByTestId(
      "project-edit-create-body-test-title",
    )) as HTMLInputElement;
    const tradeInput = (await screen.findByTestId(
      "project-edit-create-body-test-trade",
    )) as HTMLInputElement;
    const autoToggle = (await screen.findByTestId(
      "project-edit-create-body-test-title-is-auto",
    )) as HTMLInputElement;

    // Opening `rename` clears titleIsAuto; the typed name is then kept verbatim.
    expect(autoToggle.checked).toBe(true); // auto by default
    fireEvent.click(autoToggle); // → titleIsAuto = false
    fireEvent.change(titleInput, { target: { value: "New build — corner lot" } });
    fireEvent.change(tradeInput, { target: { value: "roofing" } });

    const createBtn = screen.getByRole("button", { name: "footer.create" });
    await act(async () => {
      fireEvent.click(createBtn);
    });

    await waitFor(() => {
      expect(createProjectMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(createProjectMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "New build — corner lot",
        titleIsAuto: false,
        trade: "roofing",
      }),
    );
  });

  it("fires the registered onProjectCreated callback BEFORE the meta swap", async () => {
    const callbackOrder: string[] = [];
    // The store's openProjectWindow is the only public path for
    // registering the callback (it lives in a module-scope Map). Reset
    // the store and use it to wire the window + callback in one shot.
    useWindowStore.setState({ windows: [], nextZIndex: 2000 });
    useWindowStore.getState().openProjectWindow({
      projectId: null,
      mode: "creating",
      onProjectCreated: (id: string) => {
        const win = useWindowStore
          .getState()
          .windows.find((w) => w.id === WINDOW_ID);
        callbackOrder.push(
          `cb:${id}:meta-projectId=${String((win?.meta as { projectId?: string | null } | undefined)?.projectId ?? "null")}`,
        );
      },
    });

    renderContainer();
    const titleInput = (await screen.findByTestId(
      "project-edit-create-body-test-title",
    )) as HTMLInputElement;
    const tradeInput = (await screen.findByTestId(
      "project-edit-create-body-test-trade",
    )) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Race-the-clock build" } });
    fireEvent.change(tradeInput, { target: { value: "hvac" } });

    const createBtn = screen.getByRole("button", { name: "footer.create" });
    await act(async () => {
      fireEvent.click(createBtn);
    });

    await waitFor(() => {
      expect(callbackOrder).toEqual([
        "cb:p-fresh:meta-projectId=null",
      ]);
    });

    // After meta swap, the window's projectId should be the new id.
    const win = useWindowStore
      .getState()
      .windows.find((w) => w.id === WINDOW_ID);
    expect((win?.meta as { projectId?: string | null } | undefined)?.projectId).toBe("p-fresh");
  });

  it("renders the permission-denied state when projects.create is denied", async () => {
    mockCan.mockImplementation((perm: string) => perm !== "projects.create");
    renderContainer();

    expect(
      await screen.findByTestId("project-edit-create-body-denied"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("project-edit-create-form"),
    ).not.toBeInTheDocument();
  });
});
