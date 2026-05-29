import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NotificationsDrawer } from "@/components/layouts/notifications-drawer";
import { useEdgeTabStore } from "@/stores/edge-tab-store";
import type { AppNotification } from "@/lib/api/services/notification-service";

const { dismissMutationMock, routerPushMock } = vi.hoisted(() => ({
  dismissMutationMock: vi.fn(),
  routerPushMock: vi.fn(),
}));

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

const mockNotifs: AppNotification[] = [
  {
    id: "n1",
    userId: "u1",
    companyId: "c1",
    type: "role_needed",
    title: "Role needed",
    body: "PROJ-00247",
    projectId: null,
    noteId: null,
    isRead: false,
    persistent: true,
    actionUrl: "/dashboard?openProject=00247&mode=view",
    actionLabel: "ASSIGN",
    createdAt: new Date(Date.now() - 2 * 60_000),
  },
  {
    id: "n2",
    userId: "u1",
    companyId: "c1",
    type: "mention",
    title: "Marcus mentioned you",
    body: "Waiting on quote",
    projectId: null,
    noteId: null,
    isRead: false,
    persistent: false,
    actionUrl: "/dashboard?openProject=00251&mode=view",
    actionLabel: "OPEN",
    createdAt: new Date(Date.now() - 14 * 60_000),
  },
  {
    id: "n3",
    userId: "u1",
    companyId: "c1",
    type: "gmail_sync",
    title: "Gmail sync complete",
    body: "84 threads synced",
    projectId: null,
    noteId: null,
    isRead: false,
    persistent: false,
    actionUrl: null,
    actionLabel: null,
    createdAt: new Date(Date.now() - 312 * 60_000),
  },
];

vi.mock("@/lib/hooks/use-notifications", () => ({
  useNotifications: () => ({ data: mockNotifs }),
  useDismissNotification: () => ({ mutate: dismissMutationMock, isPending: false }),
  useDismissAllNotifications: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/stores/duplicate-review-store", () => ({
  useDuplicateReviewStore: (selector: (s: { openSheet: () => void }) => unknown) =>
    selector({ openSheet: vi.fn() }),
}));

const wrap = (ui: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

describe("<NotificationsDrawer>", () => {
  beforeEach(() => {
    useEdgeTabStore.setState({ activeTab: null });
    dismissMutationMock.mockClear();
    routerPushMock.mockClear();
  });

  it("renders nothing when activeTab !== 'notifications'", () => {
    wrap(<NotificationsDrawer />);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("renders drawer when activeTab === 'notifications'", () => {
    useEdgeTabStore.setState({ activeTab: "notifications" });
    wrap(<NotificationsDrawer />);
    expect(screen.getByRole("complementary")).toBeInTheDocument();
  });

  it("shows the total notification count in the header", () => {
    useEdgeTabStore.setState({ activeTab: "notifications" });
    wrap(<NotificationsDrawer />);
    expect(screen.getAllByText("3").length).toBeGreaterThanOrEqual(1);
  });

  it("shows filter chips with per-bucket counts", () => {
    useEdgeTabStore.setState({ activeTab: "notifications" });
    wrap(<NotificationsDrawer />);
    expect(screen.getByRole("tab", { name: /filters\.critical/i })).toHaveTextContent("1");
    expect(screen.getByRole("tab", { name: /filters\.attn/i })).toHaveTextContent("1");
    expect(screen.getByRole("tab", { name: /filters\.ambient/i })).toHaveTextContent("1");
  });

  it("filters rows when a chip is clicked", async () => {
    useEdgeTabStore.setState({ activeTab: "notifications" });
    const user = userEvent.setup();
    wrap(<NotificationsDrawer />);
    expect(screen.getByText("Role needed")).toBeInTheDocument();
    expect(screen.getByText("Marcus mentioned you")).toBeInTheDocument();
    expect(screen.getByText("Gmail sync complete")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /filters\.critical/i }));
    expect(screen.getByText("Role needed")).toBeInTheDocument();
    expect(screen.queryByText("Marcus mentioned you")).not.toBeInTheDocument();
    expect(screen.queryByText("Gmail sync complete")).not.toBeInTheDocument();
  });

  it("shows filter-aware empty state", async () => {
    useEdgeTabStore.setState({ activeTab: "notifications" });
    const user = userEvent.setup();
    wrap(<NotificationsDrawer />);
    await user.click(screen.getByRole("tab", { name: /filters\.critical/i }));
    expect(screen.queryByText(/empty\.noneInBucket/)).not.toBeInTheDocument();
  });

  it("closes drawer when Escape is pressed", async () => {
    useEdgeTabStore.setState({ activeTab: "notifications" });
    const user = userEvent.setup();
    wrap(<NotificationsDrawer />);
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(useEdgeTabStore.getState().activeTab).toBeNull();
    });
  });

  it("clear-all button is disabled when no dismissible notifications exist", () => {
    useEdgeTabStore.setState({ activeTab: "notifications" });
    wrap(<NotificationsDrawer />);
    const clearBtn = screen.getByLabelText(/drawer\.clearAllAriaLabel/i);
    expect(clearBtn).not.toBeDisabled();
  });

  it("footer 'VIEW ALL →' resets filter to ALL", async () => {
    useEdgeTabStore.setState({ activeTab: "notifications" });
    const user = userEvent.setup();
    wrap(<NotificationsDrawer />);
    await user.click(screen.getByRole("tab", { name: /filters\.critical/i }));
    expect(screen.queryByText("Marcus mentioned you")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /footer\.viewAll/i }));
    expect(screen.getByText("Role needed")).toBeInTheDocument();
    expect(screen.getByText("Marcus mentioned you")).toBeInTheDocument();
    expect(screen.getByText("Gmail sync complete")).toBeInTheDocument();
  });

  it("resolves a persistent notification when its action opens a route", async () => {
    useEdgeTabStore.setState({ activeTab: "notifications" });
    const user = userEvent.setup();
    wrap(<NotificationsDrawer />);

    await user.click(screen.getByText("Role needed"));
    await user.click(screen.getByRole("button", { name: /ASSIGN/i }));

    expect(dismissMutationMock).toHaveBeenCalledWith("n1");
    expect(routerPushMock).toHaveBeenCalledWith("/dashboard?openProject=00247&mode=view");
  });
});
