import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";

// `<CreateTaskForm>` Phase 10.1-fix — the in-task-modal "Create new
// project" affordance now opens the project workspace window in
// creating mode on top of the task modal, instead of mounting a child
// `<CreateProjectModal>` dialog. When the workspace finishes its
// create, it fires `onProjectCreated` and the new project id auto-
// selects in the task picker — preserving the operator's task-form state.

const openProjectWindowMock = vi.fn();

vi.mock("@/stores/window-store", () => ({
  useWindowStore: <T,>(
    selector: (s: { openProjectWindow: typeof openProjectWindowMock }) => T,
  ) => selector({ openProjectWindow: openProjectWindowMock }),
}));

// Permission gate: default to allow `projects.create`. Per-test overrides
// reassign `permissionMockCan` to deny specific permissions.
let permissionMockCan: (key: string) => boolean = () => true;
vi.mock("@/lib/store/permissions-store", () => ({
  usePermissionStore: <T,>(
    selector: (s: { can: (key: string) => boolean }) => T,
  ) => selector({ can: (key: string) => permissionMockCan(key) }),
}));

// Hooks are stubbed to keep this an isolated component test — we're
// asserting on the create-new-project wiring, not on the data layer.
vi.mock("@/lib/hooks/use-projects", () => ({
  useProjects: () => ({
    data: {
      projects: [
        { id: "p_1", title: "Acme Reroof", client: { name: "Acme" }, address: "1 Pine St", tasks: [] },
      ],
    },
  }),
}));
vi.mock("@/lib/hooks/use-task-types", () => ({
  useTaskTypes: () => ({ data: [] }),
}));
vi.mock("@/lib/hooks/use-users", () => ({
  useTeamMembers: () => ({ data: { users: [] } }),
}));
vi.mock("@/lib/hooks/use-tasks", () => ({
  useCreateTask: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateTaskWithEvent: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({ company: { id: "c_1" } }),
}));

const { CreateTaskForm } = await import("@/components/ops/create-task-modal");

async function openProjectPicker() {
  await userEvent.click(screen.getByRole("button", { name: /select project/i }));
  return screen.findByPlaceholderText("Search projects");
}

describe("<CreateTaskForm>", () => {
  beforeEach(() => {
    openProjectWindowMock.mockReset();
    permissionMockCan = () => true;
  });

  it("clicking 'Create new project' dispatches openProjectWindow with a creating-mode + onProjectCreated callback", async () => {
    render(<CreateTaskForm />);

    // Open the canonical picker to surface the create footer action.
    await openProjectPicker();
    const createNewBtn = await screen.findByText(/^New project$/i);
    await userEvent.click(createNewBtn);

    expect(openProjectWindowMock).toHaveBeenCalledTimes(1);
    const opts = openProjectWindowMock.mock.calls[0]![0];
    expect(opts.projectId).toBeNull();
    expect(opts.mode).toBe("creating");
    expect(typeof opts.onProjectCreated).toBe("function");
  });

  it("the onProjectCreated callback auto-selects the new project in the picker", async () => {
    render(<CreateTaskForm />);

    await openProjectPicker();
    const createNewBtn = await screen.findByText(/^New project$/i);
    await userEvent.click(createNewBtn);

    // Simulate the workspace finishing its create — the container would
    // call `consumeProjectCreatedCallback(windowId, newId)` which fires
    // this callback. We invoke it directly to assert the selector
    // reacts.
    const opts = openProjectWindowMock.mock.calls[0]![0];
    await React.act(async () => {
      opts.onProjectCreated("p_new_42");
    });

    // After auto-selection, the picker enters its "selected" state
    // (search input is replaced with the picked-row chrome). With no
    // matching project in the stubbed list, we just assert the search
    // input is no longer the focused selector — i.e. the selected-row
    // X-clear button is now rendered.
    // The picker's empty-state is the X icon button with no displayed
    // project — but our useProjects mock only has p_1. p_new_42 won't
    // resolve, so the picker still shows the "Search projects..." input.
    // Instead, assert the state change indirectly: the picker's parent
    // component just received the new id via setProjectId, which means
    // the TaskForm should now be visible (it's gated on `projectId`
    // truthiness).
    // p_new_42 is truthy, so the form renders.
    // Since the project doesn't exist in the mocked list, the selected
    // row falls back to the X-clear path with an empty title — assert
    // by the presence of the unselect button (lucide X icon's button).
    const unselectBtn = screen
      .getAllByRole("button")
      .find((b) => b.querySelector("svg.lucide-x"));
    expect(unselectBtn).toBeDefined();
  });

  it("hides 'Create new project' affordance when projects.create is denied", async () => {
    permissionMockCan = (key: string) => key !== "projects.create";
    render(<CreateTaskForm />);

    await openProjectPicker();

    // Existing project still appears in the dropdown — only the create-new
    // affordance is suppressed.
    expect(await screen.findByText("Acme Reroof")).toBeInTheDocument();
    expect(screen.queryByText(/^New project$/i)).not.toBeInTheDocument();
  });
});
