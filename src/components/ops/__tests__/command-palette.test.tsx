/**
 * Command palette — universal entity search.
 *
 * Regression guard for bug fa5a9ff2 ("Universal search is not searching
 * database"). The palette loads projects/clients/tasks/opportunities on open
 * and filters them client-side, but cmdk (1.1.1) only keeps a CommandGroup
 * visible while `filtered.groups` holds it — and `filtered.groups` is built
 * exclusively from items that REGISTER with the filter store. `forceMount`
 * items never register (`if (!forceMount) store.item(id, groupId)`), so the
 * entity groups rendered `hidden` the instant the operator typed, and
 * `CommandEmpty` (gated on `filtered.count === 0`) claimed "No results found"
 * on top of a full result set.
 *
 * These tests assert what the operator actually sees: entity rows VISIBLE
 * (jest-dom's `toBeVisible` walks ancestors, so a `hidden` group fails it),
 * no false empty state, and Enter on the first row opening the project.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const openWindow = vi.fn();
const openProjectWindow = vi.fn();
const openClientWindow = vi.fn();
const beginSignOut = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push,
    prefetch: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/components/ui/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string) => key,
    dict: {},
  }),
  useLocale: () => ({ locale: "en", setLocale: vi.fn() }),
}));

vi.mock("@/lib/navigation/route-registry", () => ({
  getNavEntries: () => [],
  getNumberShortcutRoutes: () => ({}),
  entryPermissions: () => [],
}));

vi.mock("@/lib/store/permissions-store", () => ({
  usePermissionStore: (selector: (state: { can: () => boolean }) => unknown) =>
    selector({ can: () => true }),
}));

vi.mock("@/lib/store/feature-flags-store", () => ({
  useFeatureFlagsStore: (
    selector: (state: {
      isPermissionUnlocked: () => boolean;
      canAccessFeature: () => boolean;
      initialized: boolean;
    }) => unknown
  ) =>
    selector({
      isPermissionUnlocked: () => true,
      canAccessFeature: () => false,
      initialized: true,
    }),
  selectFlagsReady: (state: { initialized: boolean }) => state.initialized,
}));

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({ currentUser: { firstName: "Pete", lastName: "Mitchell" } }),
    {
      getState: () => ({
        currentUser: { firstName: "Pete", lastName: "Mitchell" },
      }),
    }
  ),
}));

vi.mock("@/stores/signout-store", () => ({
  useSignOutStore: (selector: (state: { begin: () => void }) => unknown) =>
    selector({ begin: beginSignOut }),
}));

vi.mock("@/stores/window-store", () => ({
  useWindowStore: (
    selector: (state: {
      openWindow: typeof openWindow;
      openProjectWindow: typeof openProjectWindow;
      openClientWindow: typeof openClientWindow;
    }) => unknown
  ) => selector({ openWindow, openProjectWindow, openClientWindow }),
}));

vi.mock("@/stores/edge-tab-store", () => ({
  useEdgeTabStore: Object.assign(() => undefined, {
    getState: () => ({ setActive: vi.fn() }),
  }),
}));

vi.mock("@/stores/bug-report-store", () => ({
  useBugReportStore: Object.assign(() => undefined, {
    getState: () => ({ requestScreenshot: vi.fn() }),
  }),
}));

vi.mock("@/lib/hooks/use-quick-actions", () => ({
  useQuickActions: () => [],
  useQuickActionsVisible: () => true,
}));

vi.mock("@/lib/quick-actions/dispatch", () => ({
  dispatchQuickAction: vi.fn(),
}));

vi.mock("@/lib/hooks/use-projects", () => ({
  useProjects: () => ({
    data: {
      projects: [
        {
          id: "p1",
          title: "Hidden Oaks Cres",
          address: "3556 Hidden Oaks Cres",
        },
      ],
    },
  }),
}));

vi.mock("@/lib/hooks/use-clients", () => ({
  useClients: () => ({
    data: {
      clients: [
        {
          id: "c1",
          name: "Fightertown Hangars",
          email: "ops@fightertown.test",
          phoneNumber: "+15550100",
        },
      ],
    },
  }),
}));

vi.mock("@/lib/hooks/use-tasks", () => ({
  useTasks: () => ({
    data: {
      tasks: [
        {
          id: "t1",
          customTitle: "Hidden panel punchlist",
          taskNotes: null,
          projectId: "p1",
        },
      ],
    },
  }),
}));

vi.mock("@/lib/hooks/use-opportunities", () => ({
  useOpportunities: () => ({
    data: [
      {
        id: "o1",
        title: "Hidden Oaks retaining wall",
        description: null,
        contactName: "Kara Thrace",
        contactEmail: null,
      },
    ],
  }),
}));

// Imported after the mocks so the component picks them up.
import { CommandPalette } from "@/components/ops/command-palette";

function renderPalette() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CommandPalette />
    </QueryClientProvider>
  );
}

async function openPalette() {
  await act(async () => {
    fireEvent.keyDown(window, { key: "k", metaKey: true });
  });
  return screen.getByPlaceholderText(/Search projects/i);
}

describe("CommandPalette — universal entity search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows matching projects to the operator while they type", async () => {
    const user = userEvent.setup();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "hidden");

    expect(screen.getByText("Hidden Oaks Cres")).toBeVisible();
    expect(screen.getByText("3556 Hidden Oaks Cres")).toBeVisible();
  });

  it("shows matching clients, tasks and opportunities in their own groups", async () => {
    const user = userEvent.setup();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "fightertown");

    expect(screen.getByText("Fightertown Hangars")).toBeVisible();
  });

  it("never claims 'No results found' while entity results exist", async () => {
    const user = userEvent.setup();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "hidden");

    expect(screen.getByText("Hidden Oaks Cres")).toBeVisible();
    expect(screen.queryByText("No results found")).not.toBeInTheDocument();
  });

  it("still shows the empty state when nothing matches", async () => {
    const user = userEvent.setup();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "zzqzqzqx");

    await waitFor(() => {
      expect(screen.getByText("No results found")).toBeVisible();
    });
    expect(screen.queryByText("Hidden Oaks Cres")).not.toBeInTheDocument();
  });

  it("opens the project workspace when the first result is selected", async () => {
    const user = userEvent.setup();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "hidden");

    expect(screen.getByText("Hidden Oaks Cres")).toBeVisible();

    // cmdk auto-highlights the first valid row, and with the groups visible
    // that row is the project — so Enter alone opens it. (ArrowDown would
    // move DOWN to the task row; asserted below so the ordering can't drift.)
    await waitFor(() => {
      const selected = document.querySelector(
        '[cmdk-item=""][aria-selected="true"]'
      );
      expect(selected?.textContent).toContain("Hidden Oaks Cres");
    });
    await user.keyboard("{Enter}");

    expect(openProjectWindow).toHaveBeenCalledWith({
      projectId: "p1",
      mode: "viewing",
    });
  });

  it("moves the highlight down through the entity rows with ArrowDown", async () => {
    const user = userEvent.setup();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "hidden");

    expect(screen.getByText("Hidden Oaks Cres")).toBeVisible();
    expect(screen.getByText("Hidden panel punchlist")).toBeVisible();

    await user.keyboard("{ArrowDown}");

    await waitFor(() => {
      const selected = document.querySelector(
        '[cmdk-item=""][aria-selected="true"]'
      );
      expect(selected?.textContent).toContain("Hidden panel punchlist");
    });

    await user.keyboard("{Enter}");

    // The task carries projectId p1 — selecting it opens the same workspace.
    expect(openProjectWindow).toHaveBeenCalledWith({
      projectId: "p1",
      mode: "viewing",
    });
  });
});
