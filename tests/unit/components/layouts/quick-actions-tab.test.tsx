import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuickActionsTab } from "@/components/layouts/quick-actions-tab";
import { useEdgeTabStore } from "@/stores/edge-tab-store";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
}));

vi.mock("@/lib/hooks/use-quick-actions", () => ({
  useQuickActionsVisible: () => true,
}));

describe("<QuickActionsTab>", () => {
  beforeEach(() => {
    useEdgeTabStore.setState({ activeTab: null });
  });

  it("renders the tab button", () => {
    render(<QuickActionsTab />);
    expect(
      screen.getByRole("button", { name: /tab\.ariaLabel/i }),
    ).toBeInTheDocument();
  });

  it("toggles open when clicked", async () => {
    const user = userEvent.setup();
    render(<QuickActionsTab />);
    await user.click(screen.getByRole("button", { name: /tab\.ariaLabel/i }));
    expect(useEdgeTabStore.getState().activeTab).toBe("quick-actions");
  });

  it("toggles closed when clicked while open", async () => {
    useEdgeTabStore.setState({ activeTab: "quick-actions" });
    const user = userEvent.setup();
    render(<QuickActionsTab />);
    await user.click(screen.getByRole("button", { name: /tab\.ariaLabel/i }));
    expect(useEdgeTabStore.getState().activeTab).toBeNull();
  });

  it("pressing Q toggles the drawer", async () => {
    const user = userEvent.setup();
    render(<QuickActionsTab />);
    await user.keyboard("q");
    expect(useEdgeTabStore.getState().activeTab).toBe("quick-actions");
    await user.keyboard("q");
    expect(useEdgeTabStore.getState().activeTab).toBeNull();
  });

  it("Q is suppressed when modifier keys are held", async () => {
    const user = userEvent.setup();
    render(<QuickActionsTab />);
    await user.keyboard("{Meta>}q{/Meta}");
    expect(useEdgeTabStore.getState().activeTab).toBeNull();
  });

  it("Q is suppressed when focus is in an input", async () => {
    const user = userEvent.setup();
    render(
      <>
        <input data-testid="text-input" />
        <QuickActionsTab />
      </>,
    );
    const input = screen.getByTestId("text-input");
    input.focus();
    await user.keyboard("q");
    expect(useEdgeTabStore.getState().activeTab).toBeNull();
  });

  it("opening Quick Actions atomically closes Notifications (mutual exclusion)", async () => {
    useEdgeTabStore.setState({ activeTab: "notifications" });
    const user = userEvent.setup();
    render(<QuickActionsTab />);
    await user.click(screen.getByRole("button", { name: /tab\.ariaLabel/i }));
    expect(useEdgeTabStore.getState().activeTab).toBe("quick-actions");
  });
});
