import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectStatus } from "@/lib/types/models";

// `<ProjectWorkspaceContainer>` — Phase 9.3 deliverable. Mediates between
// the slim `useWindowStore` (windowId + meta) and the rich
// `<ProjectWorkspaceWindow>` API. Owns:
//   - mode (viewing | editing | creating)
//   - active tab (edit/create only)
//   - form-id wiring for the SAVE button
//   - mode-specific footer config
//   - the meta-update path after a successful create

vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>(
    "framer-motion",
  );
  return { ...actual, useReducedMotion: () => false };
});

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
}));

const archiveMutate = vi.fn();
const saveMutate = vi.fn();
const createMutate = vi.fn();
const mockProject = vi.fn();
const mockCan = vi.fn();

vi.mock("@/lib/hooks/use-projects", () => ({
  useProject: () => mockProject(),
}));

vi.mock("@/lib/hooks/use-project-mutations", () => ({
  useProjectMutations: () => ({
    saveProject: { mutateAsync: saveMutate, isPending: false },
    createProject: { mutateAsync: createMutate, isPending: false },
    archiveProject: { mutate: archiveMutate, isPending: false },
  }),
}));

vi.mock("@/lib/store/permissions-store", () => ({
  usePermissionStore: (
    selector: (s: { can: (p: string) => boolean }) => unknown,
  ) => selector({ can: mockCan }),
}));

// Stub the heavy bodies — the container is the unit-under-test, not its
// children. Each stub exposes the props we care about as data-* attrs.
vi.mock(
  "@/components/ops/projects/workspace/viewing/project-viewing-body",
  () => ({
    ProjectViewingBody: ({ projectId }: { projectId: string }) => (
      <div data-testid="viewing-body-stub" data-project-id={projectId} />
    ),
    // The real module also re-exports ProjectSidebar — keep the surface
    // shape so the import path doesn't blow up.
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

vi.mock(
  "@/components/ops/projects/workspace/edit-create/project-edit-create-body",
  () => ({
    ProjectEditCreateBody: React.forwardRef(function MockBody(
      props: {
        mode: "editing" | "creating";
        projectId: string | null;
        tab: "identity" | "schedule";
        formId: string;
        onSaved?: (id: string) => void;
        onInvalid?: (tab: "identity" | "schedule") => void;
        discardRef?: React.Ref<{ discard: () => void }>;
      },
      _ref,
    ) {
      // Expose discard as a real handle the test can assert against.
      React.useImperativeHandle(props.discardRef, () => ({
        discard: () => {
          // tag the DOM so the test can verify the call.
          const el = document.querySelector(
            "[data-testid=edit-create-body-stub]",
          );
          el?.setAttribute("data-discarded", "true");
        },
      }));
      return (
        <form
          id={props.formId}
          data-testid="edit-create-body-stub"
          data-mode={props.mode}
          data-tab={props.tab}
          data-project-id={String(props.projectId)}
          onSubmit={(e) => {
            e.preventDefault();
            props.onSaved?.(props.projectId ?? "created-project-id");
          }}
        >
          <button type="submit">native-submit</button>
          {/* invalid-submit probe — the real body reports the tab that owns
              the first validation error via onInvalid */}
          <button
            type="button"
            data-testid="body-report-invalid-identity"
            onClick={() => props.onInvalid?.("identity")}
          >
            report-invalid
          </button>
        </form>
      );
    }),
  }),
);

// The shell is fairly self-contained; we want to see its props but not
// execute drag/resize/persistence wiring. Stub it out and surface the
// interesting wiring as test-ids.
vi.mock(
  "@/components/ops/projects/workspace/shell/project-workspace-window",
  () => ({
    ProjectWorkspaceWindow: (props: {
      id: string;
      title: string;
      crumbLabel: string;
      projectIdLabel: string;
      statusLabel: string;
      mode: "viewing" | "editing" | "creating";
      tabs?: ReadonlyArray<{ id: string; label: string }>;
      activeTabId?: string;
      onTabChange?: (id: string) => void;
      footerConfig: {
        primary?: {
          label: string;
          onClick: () => void;
          type?: string;
          form?: string;
          disabled?: boolean;
        };
        secondary: ReadonlyArray<{ label: string; onClick: () => void }>;
        ghost?: { label: string; onClick: () => void };
        destructive?: {
          label: string;
          onClick: () => void;
          disabled?: boolean;
        };
      };
      rightRail?: React.ReactNode;
      children: React.ReactNode;
    }) => (
      <div
        data-testid="window-stub"
        data-mode={props.mode}
        data-title={props.title}
        data-crumb={props.crumbLabel}
        data-project-id-label={props.projectIdLabel}
        data-status-label={props.statusLabel}
        data-tabs={JSON.stringify(props.tabs?.map((t) => t.id) ?? [])}
        data-active-tab={props.activeTabId ?? ""}
        data-window-id={props.id}
      >
        <div data-testid="window-children">{props.children}</div>
        <div data-testid="window-right-rail">{props.rightRail}</div>
        <div data-testid="window-footer">
          {props.footerConfig.destructive && (
            <button
              data-testid="footer-destructive"
              onClick={props.footerConfig.destructive.onClick}
              disabled={props.footerConfig.destructive.disabled}
            >
              {props.footerConfig.destructive.label}
            </button>
          )}
          {props.footerConfig.secondary.map((a) => (
            <button
              key={a.label}
              data-testid={`footer-secondary-${a.label}`}
              onClick={a.onClick}
            >
              {a.label}
            </button>
          ))}
          {props.footerConfig.ghost && (
            <button
              data-testid="footer-ghost"
              onClick={props.footerConfig.ghost.onClick}
            >
              {props.footerConfig.ghost.label}
            </button>
          )}
          {props.footerConfig.primary && (
            <button
              data-testid="footer-primary"
              onClick={props.footerConfig.primary.onClick}
              data-type={props.footerConfig.primary.type ?? "button"}
              data-form={props.footerConfig.primary.form ?? ""}
              disabled={props.footerConfig.primary.disabled}
            >
              {props.footerConfig.primary.label}
            </button>
          )}
        </div>
        {/* tab change probe so a test can flip the active tab */}
        {props.tabs?.map((t) => (
          <button
            key={t.id}
            data-testid={`tab-probe-${t.id}`}
            onClick={() => props.onTabChange?.(t.id)}
          />
        ))}
      </div>
    ),
  }),
);

// Window-store mock. The container reads window state by id, so we
// expose a setter for tests to seed it. A reset helper is exposed via a
// vi.fn so individual tests can swap state.
const storeState: {
  windows: Array<{
    id: string;
    type: "project-workspace";
    position: { x: number; y: number };
    size: { width: number; height: number };
    zIndex: number;
    meta?: { projectId: string | null; initialMode: "viewing" | "editing" | "creating" };
  }>;
  closeWindow: ReturnType<typeof vi.fn>;
  updateWindowMeta: ReturnType<typeof vi.fn>;
} = {
  windows: [],
  closeWindow: vi.fn(),
  updateWindowMeta: vi.fn(),
};

const consumeProjectCreatedCallbackMock = vi.fn();

vi.mock("@/stores/window-store", () => ({
  useWindowStore: <T,>(
    selector: (s: typeof storeState) => T,
  ) => selector(storeState),
  consumeProjectCreatedCallback: (windowId: string, projectId: string) =>
    consumeProjectCreatedCallbackMock(windowId, projectId),
}));

const { ProjectWorkspaceContainer } = await import(
  "@/components/ops/projects/workspace/project-workspace-container"
);

const PROJECT = {
  id: "11111111-2222-3333-4444-555555555555",
  title: "Acme HQ",
  status: ProjectStatus.InProgress,
  teamMemberIds: ["u1", "u2"],
  latitude: 1,
  longitude: 1,
} as unknown as ReturnType<typeof mockProject>["data"];

const WINDOW_ID = "project-workspace:" + PROJECT.id;

function seedViewingWindow() {
  storeState.windows = [
    {
      id: WINDOW_ID,
      type: "project-workspace",
      position: { x: 100, y: 80 },
      size: { width: 1080, height: 760 },
      zIndex: 2000,
      meta: { projectId: PROJECT.id, initialMode: "viewing" },
    },
  ];
}

function seedCreatingWindow() {
  storeState.windows = [
    {
      id: "project-workspace:new",
      type: "project-workspace",
      position: { x: 100, y: 80 },
      size: { width: 1080, height: 760 },
      zIndex: 2000,
      meta: { projectId: null, initialMode: "creating" },
    },
  ];
}

describe("<ProjectWorkspaceContainer>", () => {
  beforeEach(() => {
    storeState.windows = [];
    storeState.closeWindow.mockReset();
    storeState.updateWindowMeta.mockReset();
    consumeProjectCreatedCallbackMock.mockReset();
    archiveMutate.mockReset();
    saveMutate.mockReset();
    createMutate.mockReset();
    mockProject.mockReset();
    mockCan.mockReset();
    mockProject.mockReturnValue({ data: PROJECT, isLoading: false });
    mockCan.mockReturnValue(true);
  });

  it("renders nothing when no matching window exists in the store", () => {
    storeState.windows = [];
    const { container } = render(
      <ProjectWorkspaceContainer windowId="missing" />,
    );
    expect(container.firstChild).toBeNull();
  });

  // ── Viewing mode ──

  it("renders ProjectViewingBody + ProjectSidebar in viewing mode", () => {
    seedViewingWindow();
    render(<ProjectWorkspaceContainer windowId={WINDOW_ID} />);
    expect(screen.getByTestId("viewing-body-stub")).toHaveAttribute(
      "data-project-id",
      PROJECT.id,
    );
    expect(screen.getByTestId("sidebar-stub")).toHaveAttribute(
      "data-project-id",
      PROJECT.id,
    );
  });

  it("passes title/crumb/status chrome derived from the project (viewing)", () => {
    seedViewingWindow();
    render(<ProjectWorkspaceContainer windowId={WINDOW_ID} />);
    const win = screen.getByTestId("window-stub");
    expect(win).toHaveAttribute("data-title", PROJECT.title);
    expect(win).toHaveAttribute("data-crumb", PROJECT.title);
    expect(win).toHaveAttribute(
      "data-project-id-label",
      PROJECT.id.slice(0, 8).toUpperCase(),
    );
    expect(win).toHaveAttribute(
      "data-status-label",
      PROJECT.status.toUpperCase(),
    );
  });

  it("does not render tabs in viewing mode (Phase 7's body-level tabs own the bar)", () => {
    seedViewingWindow();
    render(<ProjectWorkspaceContainer windowId={WINDOW_ID} />);
    const win = screen.getByTestId("window-stub");
    expect(win).toHaveAttribute("data-tabs", "[]");
  });

  it("renders an EDIT primary footer button in viewing mode that flips to editing on click", async () => {
    seedViewingWindow();
    render(<ProjectWorkspaceContainer windowId={WINDOW_ID} />);
    const editBtn = screen.getByTestId("footer-primary");
    // Container resolves footer label via t("footer.edit") — mocked dict
    // returns the key string directly.
    expect(editBtn).toHaveTextContent("footer.edit");

    await userEvent.click(editBtn);
    // mode flipped → window now reports editing + composer renders
    expect(screen.getByTestId("window-stub")).toHaveAttribute(
      "data-mode",
      "editing",
    );
    expect(screen.getByTestId("edit-create-body-stub")).toBeInTheDocument();
  });

  // ── Editing mode ──

  it("renders the edit/create body + identity+schedule tabs in editing mode", async () => {
    seedViewingWindow();
    render(<ProjectWorkspaceContainer windowId={WINDOW_ID} />);
    await userEvent.click(screen.getByTestId("footer-primary"));

    const win = screen.getByTestId("window-stub");
    expect(win).toHaveAttribute("data-tabs", JSON.stringify([
      "identity",
      "schedule",
    ]));
    expect(win).toHaveAttribute("data-active-tab", "identity");
    expect(screen.getByTestId("edit-create-body-stub")).toHaveAttribute(
      "data-mode",
      "editing",
    );
  });

  it("editing footer primary is type=submit and form= matches the composer's formId", async () => {
    seedViewingWindow();
    render(<ProjectWorkspaceContainer windowId={WINDOW_ID} />);
    await userEvent.click(screen.getByTestId("footer-primary"));

    const primary = screen.getByTestId("footer-primary");
    expect(primary).toHaveAttribute("data-type", "submit");
    const formAttr = primary.getAttribute("data-form");
    const composerForm = screen.getByTestId("edit-create-body-stub");
    expect(formAttr).toBeTruthy();
    expect(formAttr).toBe(composerForm.getAttribute("id"));
  });

  it("editing CANCEL ghost flips back to viewing without mutation", async () => {
    seedViewingWindow();
    render(<ProjectWorkspaceContainer windowId={WINDOW_ID} />);
    await userEvent.click(screen.getByTestId("footer-primary")); // EDIT
    await userEvent.click(screen.getByTestId("footer-ghost")); // CANCEL
    expect(screen.getByTestId("window-stub")).toHaveAttribute(
      "data-mode",
      "viewing",
    );
    expect(saveMutate).not.toHaveBeenCalled();
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("editing DISCARD CHANGES triggers the composer's discard handle", async () => {
    seedViewingWindow();
    render(<ProjectWorkspaceContainer windowId={WINDOW_ID} />);
    await userEvent.click(screen.getByTestId("footer-primary")); // EDIT
    // Container resolves the secondary label via t("footer.discard");
    // the stub mock window builds the testid suffix from that label,
    // which under the test mock collapses to the dictionary key.
    await userEvent.click(screen.getByTestId("footer-secondary-footer.discard"));
    const stub = screen.getByTestId("edit-create-body-stub");
    expect(stub.getAttribute("data-discarded")).toBe("true");
  });

  it("editing ARCHIVE opens the ConfirmModal and only fires archiveProject after confirm", async () => {
    seedViewingWindow();
    render(<ProjectWorkspaceContainer windowId={WINDOW_ID} />);
    await userEvent.click(screen.getByTestId("footer-primary")); // EDIT
    await userEvent.click(screen.getByTestId("footer-destructive"));

    // Modal opens — archive mutation has NOT fired yet.
    expect(screen.getByTestId("confirm-modal")).toBeInTheDocument();
    expect(archiveMutate).not.toHaveBeenCalled();

    // Confirm fires the mutation with the project's team.
    await userEvent.click(screen.getByTestId("confirm-modal-confirm"));
    expect(archiveMutate).toHaveBeenCalledTimes(1);
    expect(archiveMutate.mock.calls[0]![0]).toEqual({
      projectId: PROJECT.id,
      projectTitle: PROJECT.title,
      notifyUserIds: PROJECT.teamMemberIds,
    });
  });

  it("editing ARCHIVE Cancel dismisses the modal without firing the mutation", async () => {
    seedViewingWindow();
    render(<ProjectWorkspaceContainer windowId={WINDOW_ID} />);
    await userEvent.click(screen.getByTestId("footer-primary")); // EDIT
    await userEvent.click(screen.getByTestId("footer-destructive"));
    expect(screen.getByTestId("confirm-modal")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("confirm-modal-cancel"));
    await waitFor(() =>
      expect(screen.queryByTestId("confirm-modal")).toBeNull(),
    );
    expect(archiveMutate).not.toHaveBeenCalled();
  });

  it("hides the ARCHIVE destructive button when projects.archive is missing", async () => {
    mockCan.mockImplementation((perm: string) => perm !== "projects.archive");
    seedViewingWindow();
    render(<ProjectWorkspaceContainer windowId={WINDOW_ID} />);
    await userEvent.click(screen.getByTestId("footer-primary")); // EDIT
    expect(screen.queryByTestId("footer-destructive")).toBeNull();
  });

  it("flips back to viewing after a successful save (onSaved fires)", async () => {
    seedViewingWindow();
    render(<ProjectWorkspaceContainer windowId={WINDOW_ID} />);
    await userEvent.click(screen.getByTestId("footer-primary")); // EDIT

    // Drive submit through the mocked form (click type=submit inside it)
    const composer = screen.getByTestId("edit-create-body-stub");
    composer.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("window-stub")).toHaveAttribute(
        "data-mode",
        "viewing",
      );
    });
    expect(storeState.updateWindowMeta).not.toHaveBeenCalled();
  });

  // ── Creating mode ──

  it("renders an empty composer in creating mode with no rightRail", () => {
    seedCreatingWindow();
    mockProject.mockReturnValue({ data: undefined, isLoading: false });
    render(<ProjectWorkspaceContainer windowId="project-workspace:new" />);
    expect(screen.getByTestId("edit-create-body-stub")).toHaveAttribute(
      "data-mode",
      "creating",
    );
    // rightRail container exists but is empty (no sidebar in creating)
    expect(screen.queryByTestId("sidebar-stub")).not.toBeInTheDocument();
  });

  it("creating footer ghost is CANCEL and closes the window", async () => {
    seedCreatingWindow();
    mockProject.mockReturnValue({ data: undefined, isLoading: false });
    render(<ProjectWorkspaceContainer windowId="project-workspace:new" />);
    await userEvent.click(screen.getByTestId("footer-ghost"));
    expect(storeState.closeWindow).toHaveBeenCalledWith(
      "project-workspace:new",
    );
  });

  it("creating primary is CREATE with type=submit + matching form id", () => {
    seedCreatingWindow();
    mockProject.mockReturnValue({ data: undefined, isLoading: false });
    render(<ProjectWorkspaceContainer windowId="project-workspace:new" />);
    const primary = screen.getByTestId("footer-primary");
    // Creating mode primary CTA resolves via t("footer.create").
    expect(primary).toHaveTextContent("footer.create");
    expect(primary).toHaveAttribute("data-type", "submit");
    const composerForm = screen.getByTestId("edit-create-body-stub");
    expect(primary.getAttribute("data-form")).toBe(
      composerForm.getAttribute("id"),
    );
  });

  it("after a successful create, calls updateWindowMeta with the new project id and switches to viewing", async () => {
    seedCreatingWindow();
    mockProject.mockReturnValue({ data: undefined, isLoading: false });
    render(<ProjectWorkspaceContainer windowId="project-workspace:new" />);

    const composer = screen.getByTestId("edit-create-body-stub");
    composer.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );

    await waitFor(() => {
      expect(storeState.updateWindowMeta).toHaveBeenCalledTimes(1);
    });
    expect(storeState.updateWindowMeta.mock.calls[0]![0]).toBe(
      "project-workspace:new",
    );
    expect(storeState.updateWindowMeta.mock.calls[0]![1]).toEqual({
      projectId: "created-project-id",
      initialMode: "viewing",
    });
  });

  it("fires consumeProjectCreatedCallback BEFORE the meta swap so the parent observes the new id first (10.1-fix)", async () => {
    // Order matters: the in-task-modal flow expects the new project id
    // to land in its <ProjectSelector> before the workspace transitions
    // to viewing — otherwise the user sees a stale selector for a frame.
    seedCreatingWindow();
    mockProject.mockReturnValue({ data: undefined, isLoading: false });
    render(<ProjectWorkspaceContainer windowId="project-workspace:new" />);

    const composer = screen.getByTestId("edit-create-body-stub");
    composer.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );

    await waitFor(() => {
      expect(consumeProjectCreatedCallbackMock).toHaveBeenCalledTimes(1);
    });
    expect(consumeProjectCreatedCallbackMock).toHaveBeenCalledWith(
      "project-workspace:new",
      "created-project-id",
    );
    // Order assertion: the callback fires BEFORE updateWindowMeta.
    const cbOrder =
      consumeProjectCreatedCallbackMock.mock.invocationCallOrder[0]!;
    const metaOrder = storeState.updateWindowMeta.mock.invocationCallOrder[0]!;
    expect(cbOrder).toBeLessThan(metaOrder);
  });

  // ── Tab change ──

  it("flips activeTab when ProjectWorkspaceWindow.onTabChange is called", async () => {
    seedViewingWindow();
    render(<ProjectWorkspaceContainer windowId={WINDOW_ID} />);
    await userEvent.click(screen.getByTestId("footer-primary")); // EDIT
    await userEvent.click(screen.getByTestId("tab-probe-schedule"));
    expect(screen.getByTestId("window-stub")).toHaveAttribute(
      "data-active-tab",
      "schedule",
    );
    expect(screen.getByTestId("edit-create-body-stub")).toHaveAttribute(
      "data-tab",
      "schedule",
    );
  });

  it("flips to the tab reported by the body's onInvalid (silent dead-end guard)", async () => {
    // Creating mode, operator on the schedule tab, trade never picked: the
    // CREATE submit fails on a field whose error renders in the identity tab.
    // The container must flip there so the failure is visible.
    seedCreatingWindow();
    render(<ProjectWorkspaceContainer windowId="project-workspace:new" />);
    await userEvent.click(screen.getByTestId("tab-probe-schedule"));
    expect(screen.getByTestId("window-stub")).toHaveAttribute(
      "data-active-tab",
      "schedule",
    );

    await userEvent.click(screen.getByTestId("body-report-invalid-identity"));
    expect(screen.getByTestId("window-stub")).toHaveAttribute(
      "data-active-tab",
      "identity",
    );
    expect(screen.getByTestId("edit-create-body-stub")).toHaveAttribute(
      "data-tab",
      "identity",
    );
  });
});
