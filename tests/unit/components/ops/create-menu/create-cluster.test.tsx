import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateCluster } from "@/components/ops/create-menu/create-cluster";
import { useEdgeTabStore } from "@/stores/edge-tab-store";

// ── Mocks ────────────────────────────────────────────────────────────────
// Dictionary is identity: t("trigger.ariaLabel") → "trigger.ariaLabel", so
// queries below match the key strings.
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const openWindowMock = vi.fn();
const openProjectWindowMock = vi.fn();
const openClientWindowMock = vi.fn();
vi.mock("@/stores/window-store", () => ({
  useWindowStore: (selector: (s: unknown) => unknown) =>
    selector({
      openWindow: openWindowMock,
      openProjectWindow: openProjectWindowMock,
      openClientWindow: openClientWindowMock,
    }),
}));

const requestScreenshotMock = vi.fn();
vi.mock("@/stores/bug-report-store", () => ({
  useBugReportStore: {
    getState: () => ({ requestScreenshot: requestScreenshotMock }),
  },
}));

let isCompleteValue = true;
vi.mock("@/hooks/useSetupGate", () => ({
  useSetupGate: () => ({ isComplete: isCompleteValue, missingSteps: [] }),
}));
vi.mock("@/components/setup/SetupInterceptionModal", () => ({
  SetupInterceptionModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="setup-modal" /> : null,
}));

import type { FABAction } from "@/lib/constants/fab-actions";
const mockActions: FABAction[] = [
  {
    id: "task",
    labelKey: "action.task",
    hintCode: "TSK",
    hotkey: "T",
    icon: () => <svg data-testid="ico-task" />,
    triggerAction: "tasks",
    handler: "window",
    target: "create-task",
  } as FABAction,
  {
    id: "project",
    labelKey: "action.project",
    hintCode: "PRJ",
    hotkey: "P",
    icon: () => <svg data-testid="ico-project" />,
    triggerAction: "projects",
    handler: "window",
    target: "project-workspace",
    meta: { initialMode: "creating" },
  } as FABAction,
  {
    id: "expense",
    labelKey: "action.expense",
    hintCode: "EXP",
    hotkey: "X",
    icon: () => <svg data-testid="ico-expense" />,
    triggerAction: "expenses",
    handler: "route",
    target: "/books?segment=expenses",
  } as FABAction,
];
vi.mock("@/lib/hooks/use-quick-actions", () => ({
  useQuickActions: () => mockActions,
  useQuickActionsVisible: () => true,
}));

const createTrigger = () =>
  screen.getByRole("button", { name: /trigger\.ariaLabel/i });
const bugGlyph = () => screen.getByRole("button", { name: /bugReport\.title/i });

// The controls are edge-revealed: retracted (pointer-events: none) until the
// cursor nears the right edge. Simulate that proximity so clicks land, exactly
// as a real user would by moving to the edge first.
const revealCluster = () =>
  act(() => {
    const ev = new Event("pointermove");
    Object.defineProperty(ev, "clientX", { value: 5000 });
    window.dispatchEvent(ev);
  });

describe("<CreateCluster>", () => {
  beforeEach(() => {
    pushMock.mockClear();
    openWindowMock.mockClear();
    openProjectWindowMock.mockClear();
    openClientWindowMock.mockClear();
    requestScreenshotMock.mockClear();
    isCompleteValue = true;
    useEdgeTabStore.setState({ activeTab: null });
  });

  it("renders the create trigger and the (subordinate) bug glyph", () => {
    render(<CreateCluster />);
    expect(createTrigger()).toBeInTheDocument();
    expect(bugGlyph()).toBeInTheDocument();
  });

  it("clicking the create trigger opens the menu", async () => {
    const user = userEvent.setup();
    render(<CreateCluster />);
    revealCluster();
    await user.click(createTrigger());
    expect(useEdgeTabStore.getState().activeTab).toBe("quick-actions");
  });

  it("clicking the create trigger while open closes the menu", async () => {
    useEdgeTabStore.setState({ activeTab: "quick-actions" });
    const user = userEvent.setup();
    render(<CreateCluster />);
    await user.click(createTrigger());
    expect(useEdgeTabStore.getState().activeTab).toBeNull();
  });

  it("pressing Q toggles the menu", async () => {
    const user = userEvent.setup();
    render(<CreateCluster />);
    await user.keyboard("q");
    expect(useEdgeTabStore.getState().activeTab).toBe("quick-actions");
    await user.keyboard("q");
    expect(useEdgeTabStore.getState().activeTab).toBeNull();
  });

  it("Q is suppressed when modifier keys are held", async () => {
    const user = userEvent.setup();
    render(<CreateCluster />);
    await user.keyboard("{Meta>}q{/Meta}");
    expect(useEdgeTabStore.getState().activeTab).toBeNull();
  });

  it("Q is suppressed when focus is in an input", async () => {
    const user = userEvent.setup();
    render(
      <>
        <input data-testid="text-input" />
        <CreateCluster />
      </>,
    );
    screen.getByTestId("text-input").focus();
    await user.keyboard("q");
    expect(useEdgeTabStore.getState().activeTab).toBeNull();
  });

  it("clicking the bug glyph captures a screenshot and opens the bug drawer", async () => {
    const user = userEvent.setup();
    render(<CreateCluster />);
    revealCluster();
    await user.click(bugGlyph());
    expect(requestScreenshotMock).toHaveBeenCalledTimes(1);
    expect(useEdgeTabStore.getState().activeTab).toBe("bug-report");
  });

  it("pressing ` captures a screenshot and opens the bug drawer", async () => {
    const user = userEvent.setup();
    render(<CreateCluster />);
    await user.keyboard("`");
    expect(requestScreenshotMock).toHaveBeenCalledTimes(1);
    expect(useEdgeTabStore.getState().activeTab).toBe("bug-report");
  });

  it("opening Create by keyboard atomically closes another open surface (mutual exclusion)", async () => {
    useEdgeTabStore.setState({ activeTab: "notifications" });
    const user = userEvent.setup();
    render(<CreateCluster />);
    // A foreign surface deliberately retracts the edge controls so they cannot
    // overlap its drawer. The global Q shortcut remains the supported way to
    // switch directly to Create while another edge surface owns the screen.
    await user.keyboard("q");
    expect(useEdgeTabStore.getState().activeTab).toBe("quick-actions");
  });

  it("clicking a window action opens that window and closes the menu", async () => {
    useEdgeTabStore.setState({ activeTab: "quick-actions" });
    const user = userEvent.setup();
    render(<CreateCluster />);
    await user.click(await screen.findByText("action.task"));
    // The wheel plays a brief press state before dispatching, so the open is async.
    await waitFor(() =>
      expect(openWindowMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "create-task",
          type: "create-task",
          title: "action.task",
        }),
      ),
    );
    expect(useEdgeTabStore.getState().activeTab).toBeNull();
  });

  it("clicking the project-workspace action opens the project window", async () => {
    useEdgeTabStore.setState({ activeTab: "quick-actions" });
    const user = userEvent.setup();
    render(<CreateCluster />);
    await user.click(await screen.findByText("action.project"));
    await waitFor(() =>
      expect(openProjectWindowMock).toHaveBeenCalledWith({
        projectId: null,
        mode: "creating",
      }),
    );
    expect(useEdgeTabStore.getState().activeTab).toBeNull();
  });

  it("clicking a route action navigates and closes the menu", async () => {
    useEdgeTabStore.setState({ activeTab: "quick-actions" });
    const user = userEvent.setup();
    render(<CreateCluster />);
    await user.click(await screen.findByText("action.expense"));
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/books?segment=expenses"),
    );
    expect(useEdgeTabStore.getState().activeTab).toBeNull();
  });

  it("the customize footer routes to settings and closes the wheel", async () => {
    useEdgeTabStore.setState({ activeTab: "quick-actions" });
    const user = userEvent.setup();
    render(<CreateCluster />);
    await user.click(await screen.findByText(/footer\.customize/i));
    expect(pushMock).toHaveBeenCalledWith("/settings?tab=quick-actions");
    expect(useEdgeTabStore.getState().activeTab).toBeNull();
  });

  it("gates the action behind the setup modal when setup is incomplete", async () => {
    isCompleteValue = false;
    useEdgeTabStore.setState({ activeTab: "quick-actions" });
    const user = userEvent.setup();
    render(<CreateCluster />);
    await user.click(await screen.findByText("action.task"));
    await waitFor(() =>
      expect(screen.getByTestId("setup-modal")).toBeInTheDocument(),
    );
    expect(openWindowMock).not.toHaveBeenCalled();
  });
});
