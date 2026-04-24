import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NotificationsTab } from "@/components/layouts/notifications-tab";
import { useEdgeTabStore } from "@/stores/edge-tab-store";
import type { AppNotification } from "@/lib/api/services/notification-service";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
}));

const mockNotifs: AppNotification[] = [
  {
    id: "n1",
    userId: "u1",
    companyId: "c1",
    type: "role_needed",
    title: "Role needed",
    body: "x",
    projectId: null,
    noteId: null,
    isRead: false,
    persistent: true,
    actionUrl: null,
    actionLabel: null,
    createdAt: new Date(),
  },
  {
    id: "n2",
    userId: "u1",
    companyId: "c1",
    type: "mention",
    title: "Mention",
    body: "x",
    projectId: null,
    noteId: null,
    isRead: false,
    persistent: false,
    actionUrl: null,
    actionLabel: null,
    createdAt: new Date(),
  },
];

vi.mock("@/lib/hooks/use-notifications", () => ({
  useNotifications: () => ({ data: mockNotifs }),
}));

const wrap = (ui: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

describe("<NotificationsTab>", () => {
  beforeEach(() => {
    useEdgeTabStore.setState({ activeTab: null });
  });

  it("renders the tab with the notification count", () => {
    wrap(<NotificationsTab />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("toggles the drawer open when clicked", async () => {
    const user = userEvent.setup();
    wrap(<NotificationsTab />);
    await user.click(screen.getByRole("button", { name: /tab\.ariaLabel/i }));
    expect(useEdgeTabStore.getState().activeTab).toBe("notifications");
  });

  it("toggles closed when clicked while open", async () => {
    useEdgeTabStore.setState({ activeTab: "notifications" });
    const user = userEvent.setup();
    wrap(<NotificationsTab />);
    await user.click(screen.getByRole("button", { name: /tab\.ariaLabel/i }));
    expect(useEdgeTabStore.getState().activeTab).toBeNull();
  });

  it("pressing N toggles the drawer", async () => {
    const user = userEvent.setup();
    wrap(<NotificationsTab />);
    await user.keyboard("n");
    expect(useEdgeTabStore.getState().activeTab).toBe("notifications");
    await user.keyboard("n");
    expect(useEdgeTabStore.getState().activeTab).toBeNull();
  });

  it("N with Cmd modifier does NOT toggle", async () => {
    const user = userEvent.setup();
    wrap(<NotificationsTab />);
    await user.keyboard("{Meta>}n{/Meta}");
    expect(useEdgeTabStore.getState().activeTab).toBeNull();
  });

  it("N inside an input does NOT toggle", async () => {
    const user = userEvent.setup();
    wrap(
      <>
        <input data-testid="input" />
        <NotificationsTab />
      </>,
    );
    const input = screen.getByTestId("input");
    input.focus();
    await user.keyboard("n");
    expect(useEdgeTabStore.getState().activeTab).toBeNull();
  });
});
