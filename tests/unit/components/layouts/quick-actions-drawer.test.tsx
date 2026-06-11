import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuickActionsDrawer } from "@/components/layouts/quick-actions-drawer";
import { useEdgeTabStore } from "@/stores/edge-tab-store";

// ── Mocks ────────────────────────────────────────────────────────────────

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const openWindowMock = vi.fn();
vi.mock("@/stores/window-store", () => ({
  useWindowStore: (selector: (s: unknown) => unknown) =>
    selector({ openWindow: openWindowMock }),
}));

// SetupGate: complete by default
let isCompleteValue = true;
vi.mock("@/hooks/useSetupGate", () => ({
  useSetupGate: () => ({ isComplete: isCompleteValue, missingSteps: [] }),
}));

vi.mock("@/components/setup/SetupInterceptionModal", () => ({
  SetupInterceptionModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="setup-modal" /> : null,
}));

// useQuickActions returns a fixed list
import type { FABAction } from "@/lib/constants/fab-actions";
const mockActions: FABAction[] = [
  {
    id: "project",
    labelKey: "action.project",
    hintCode: "PRJ",
    icon: () => <svg data-testid="ico-project" />,
    triggerAction: "projects",
    handler: "window",
    target: "create-project",
  } as FABAction,
  {
    id: "expense",
    labelKey: "action.expense",
    hintCode: "EXP",
    icon: () => <svg data-testid="ico-expense" />,
    triggerAction: "expenses",
    handler: "route",
    target: "/accounting?tab=expenses",
  } as FABAction,
];
vi.mock("@/lib/hooks/use-quick-actions", () => ({
  useQuickActions: () => mockActions,
  useQuickActionsVisible: () => true,
}));

describe("<QuickActionsDrawer>", () => {
  beforeEach(() => {
    pushMock.mockClear();
    openWindowMock.mockClear();
    isCompleteValue = true;
    useEdgeTabStore.setState({ activeTab: "quick-actions" });
  });

  it("renders all actions when open", () => {
    render(<QuickActionsDrawer />);
    expect(screen.getByText("action.project")).toBeInTheDocument();
    expect(screen.getByText("action.expense")).toBeInTheDocument();
    expect(screen.getByText("PRJ")).toBeInTheDocument();
    expect(screen.getByText("EXP")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    useEdgeTabStore.setState({ activeTab: null });
    render(<QuickActionsDrawer />);
    expect(screen.queryByText("action.project")).not.toBeInTheDocument();
  });

  it("clicking a window-handler action opens that window and closes drawer", async () => {
    const user = userEvent.setup();
    render(<QuickActionsDrawer />);
    await user.click(screen.getByText("action.project"));
    expect(openWindowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "create-project",
        type: "create-project",
        title: "action.project",
      }),
    );
    expect(useEdgeTabStore.getState().activeTab).toBeNull();
  });

  it("clicking a route-handler action navigates and closes drawer", async () => {
    const user = userEvent.setup();
    render(<QuickActionsDrawer />);
    await user.click(screen.getByText("action.expense"));
    expect(pushMock).toHaveBeenCalledWith("/accounting?tab=expenses");
    expect(useEdgeTabStore.getState().activeTab).toBeNull();
  });

  it("clicking CUSTOMIZE routes to settings and closes drawer", async () => {
    const user = userEvent.setup();
    render(<QuickActionsDrawer />);
    await user.click(screen.getByRole("button", { name: /customizeAriaLabel/i }));
    expect(pushMock).toHaveBeenCalledWith("/settings?tab=quick-actions");
    expect(useEdgeTabStore.getState().activeTab).toBeNull();
  });

  it("Escape closes the drawer", async () => {
    const user = userEvent.setup();
    render(<QuickActionsDrawer />);
    await user.keyboard("{Escape}");
    expect(useEdgeTabStore.getState().activeTab).toBeNull();
  });

  it("opens SetupInterceptionModal when setup is incomplete", async () => {
    isCompleteValue = false;
    const user = userEvent.setup();
    render(<QuickActionsDrawer />);
    await user.click(screen.getByText("action.project"));
    expect(screen.getByTestId("setup-modal")).toBeInTheDocument();
    // Drawer is NOT closed because action is gated
    expect(useEdgeTabStore.getState().activeTab).toBe("quick-actions");
    expect(openWindowMock).not.toHaveBeenCalled();
  });
});
