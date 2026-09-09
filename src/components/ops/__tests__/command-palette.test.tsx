/**
 * Command palette — universal entity search.
 *
 * The palette used to download every project, client, task and opportunity on
 * open and substring-filter them in the browser (bug fa5a9ff2, "universal
 * search is not searching database"). It now renders one ranked envelope from
 * `search_workspace` through `useWorkspaceSearch`. Two things survive from that
 * bug and are asserted here forever:
 *
 * 1. cmdk (1.1.1) keeps a `CommandGroup` visible only while `filtered.groups`
 *    holds it, and that set is built exclusively from items that REGISTER with
 *    the filter store. `forceMount` items never register, so every entity group
 *    must carry `forceMount` too or it renders `hidden` the instant the
 *    operator types. `toBeVisible` walks ancestors, so a hidden group fails it.
 * 2. `CommandEmpty` is gated on `filtered.count === 0`, which forceMount rows
 *    never raise — so it must be kept out of the tree entirely whenever the
 *    envelope has hits, or it claims "no matches" on top of a full result set.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptyWorkspaceSearchResult,
  type WorkspaceSearchResult,
} from "@/lib/types/workspace-search";

const push = vi.fn();
const openWindow = vi.fn();
const openProjectWindow = vi.fn();
const openClientWindow = vi.fn();
const beginSignOut = vi.fn();
const refetch = vi.fn();

/** Per-test permission answers — the Documents group is permission-gated. */
const permissions = vi.hoisted(() => ({
  can: (_permission: string) => true as boolean,
}));

/** Per-test search state, read at render time so tests can reshape it. */
const searchState = vi.hoisted(() => ({
  current: null as unknown,
}));

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

// The real dictionary, with the real fallback semantics of `t(key, fallback)`.
// Asserting the shipped copy is the point — a key-echoing stub would pass even
// if the palette rendered raw dot-keys to the operator.
vi.mock("@/i18n/client", async () => {
  const en = (await import("@/i18n/dictionaries/en/command-palette.json"))
    .default as Record<string, string>;
  return {
    useDictionary: (namespace: string) => ({
      t: (key: string, fallback?: string | Record<string, unknown>) => {
        const value = namespace === "command-palette" ? en[key] : undefined;
        if (typeof value === "string") return value;
        return typeof fallback === "string" ? fallback : key;
      },
      dict: {},
    }),
    useLocale: () => ({ locale: "en", setLocale: vi.fn() }),
  };
});

vi.mock("@/lib/navigation/route-registry", () => ({
  getNavEntries: () => [],
  getNumberShortcutRoutes: () => ({}),
  entryPermissions: () => [],
}));

vi.mock("@/lib/store/permissions-store", () => ({
  usePermissionStore: (
    selector: (state: { can: (permission: string) => boolean }) => unknown,
  ) => selector({ can: (permission: string) => permissions.can(permission) }),
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

vi.mock("@/lib/hooks/use-workspace-search", () => ({
  useWorkspaceSearch: () => searchState.current,
}));

// Imported after the mocks so the component picks them up.
import { CommandPalette } from "@/components/ops/command-palette";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const UPDATED = "2026-09-01T00:00:00Z";

function fullEnvelope(): WorkspaceSearchResult {
  return {
    ...emptyWorkspaceSearchResult(),
    query: "hidden",
    tokens: ["hidden"],
    projects: {
      // More matches than rows — the heading has to say so.
      total: 12,
      items: [
        {
          id: "p1",
          title: "Hidden Oaks Cres",
          address: "3556 Hidden Oaks Cres",
          status: "in_progress",
          client_name: "Fightertown Hangars",
          updated_at: UPDATED,
        },
      ],
    },
    clients: {
      total: 1,
      items: [
        {
          id: "c1",
          name: "Fightertown Hangars",
          email: "ops@fightertown.test",
          phone: "(250) 555-1234",
          address: null,
          updated_at: UPDATED,
        },
      ],
    },
    leads: {
      total: 1,
      items: [
        {
          id: "l1",
          title: "Deck rebuild",
          contact_name: "Rick Heatherly",
          stage: "quoted",
          address: null,
          updated_at: UPDATED,
        },
      ],
    },
    tasks: {
      total: 1,
      items: [
        {
          id: "t1",
          title: "Frame stairs",
          project_id: "p1",
          project_title: "Hidden Oaks Cres",
          task_type: "Framing",
          status: "active",
          updated_at: UPDATED,
        },
      ],
    },
    documents: {
      total: 2,
      items: [
        {
          id: "i1",
          kind: "invoice",
          number: "INV-1042",
          title: "Deck rebuild",
          client_name: "Fightertown Hangars",
          total: 4812.5,
          status: "sent",
          updated_at: UPDATED,
        },
        {
          id: "e1",
          kind: "estimate",
          number: "EST-0088",
          title: "Rail upgrade",
          client_name: "Fightertown Hangars",
          total: 1200,
          status: "approved",
          updated_at: UPDATED,
        },
      ],
    },
  };
}

/** One kind only — so the auto-highlighted first row is that kind's row. */
function onlyKind<K extends keyof WorkspaceSearchResult>(
  kind: K,
  group: WorkspaceSearchResult[K],
): WorkspaceSearchResult {
  return { ...emptyWorkspaceSearchResult(), query: "hidden", tokens: ["hidden"], [kind]: group };
}

interface SearchStateOverrides {
  result?: WorkspaceSearchResult | null;
  activeQuery?: string;
  isPlaceholderData?: boolean;
  isFetching?: boolean;
  isError?: boolean;
  enabled?: boolean;
}

function setSearch(overrides: SearchStateOverrides = {}) {
  searchState.current = {
    result: overrides.result ?? fullEnvelope(),
    activeQuery: overrides.activeQuery ?? "hidden",
    isPlaceholderData: overrides.isPlaceholderData ?? false,
    isFetching: overrides.isFetching ?? false,
    isError: overrides.isError ?? false,
    error: overrides.isError ? new Error("rpc down") : null,
    refetch,
    enabled: overrides.enabled ?? true,
  };
}

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
  return screen.getByPlaceholderText(/search or run a command/i);
}

function headingsInDomOrder(): string[] {
  return Array.from(document.querySelectorAll("[cmdk-group-heading]")).map((el) =>
    (el.textContent ?? "").trim()
  );
}

function selectedRowText(): string {
  return (
    document.querySelector('[cmdk-item=""][aria-selected="true"]')?.textContent ?? ""
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("CommandPalette — universal entity search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissions.can = () => true;
    setSearch();
  });

  it("shows matching projects to the operator while they type", async () => {
    const user = userEvent.setup();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "hidden");

    expect(screen.getAllByText("Hidden Oaks Cres")[0]).toBeVisible();
    expect(screen.getByText("3556 Hidden Oaks Cres")).toBeVisible();
  });

  it("renders the five kinds as groups in the app's own order", async () => {
    const user = userEvent.setup();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "hidden");

    const headings = headingsInDomOrder();
    expect(headings.slice(0, 5)).toEqual([
      "Projects · 12",
      "Clients",
      "Leads",
      "Tasks",
      "Documents",
    ]);
  });

  it("counts a group's heading only when rows were left behind", async () => {
    const user = userEvent.setup();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "hidden");

    // Clients: total 1, one row rendered — nothing withheld, so no count.
    expect(headingsInDomOrder()).toContain("Clients");
    expect(headingsInDomOrder()).not.toContain("Clients · 1");
  });

  it("shows each kind's secondary line so duplicates can be told apart", async () => {
    const user = userEvent.setup();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "hidden");

    expect(screen.getByText("3556 Hidden Oaks Cres")).toBeVisible();
    expect(screen.getByText("(250) 555-1234")).toBeVisible();
    expect(screen.getByText("Rick Heatherly")).toBeVisible();
    // The task's second line is its project — that is how the operator knows
    // which "Frame stairs" this is.
    expect(screen.getAllByText("Hidden Oaks Cres").length).toBeGreaterThan(1);
    expect(screen.getByText("$4,812.50")).toBeVisible();
  });

  it("tags every hit with its status, in the app's own words", async () => {
    const user = userEvent.setup();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "hidden");

    expect(screen.getByText("In progress")).toBeVisible(); // project
    expect(screen.getByText("Quoted")).toBeVisible(); // lead stage
    expect(screen.getByText("Active")).toBeVisible(); // task
    expect(screen.getByText("Sent")).toBeVisible(); // invoice
    expect(screen.getByText("Approved")).toBeVisible(); // estimate
  });

  it("renders an em dash where a client has no phone and no email", async () => {
    setSearch({
      result: onlyKind("clients", {
        total: 1,
        items: [
          {
            id: "c1",
            name: "Fightertown Hangars",
            email: null,
            phone: null,
            address: null,
            updated_at: null,
          },
        ],
      }),
    });
    const user = userEvent.setup();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "fightertown");

    expect(screen.getByText("—")).toBeVisible();
  });

  it("hides the Documents group from an operator who can see neither book", async () => {
    permissions.can = (permission: string) =>
      permission !== "invoices.view" && permission !== "estimates.view";
    const user = userEvent.setup();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "hidden");

    expect(headingsInDomOrder()).not.toContain("Documents");
    expect(screen.queryByText("INV-1042")).not.toBeInTheDocument();
    // The other four kinds are untouched.
    expect(screen.getAllByText("Hidden Oaks Cres")[0]).toBeVisible();
  });

  it("shows the Documents group to an operator who can see only estimates", async () => {
    permissions.can = (permission: string) => permission !== "invoices.view";
    const user = userEvent.setup();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "hidden");

    expect(headingsInDomOrder()).toContain("Documents");
  });

  it("never claims no matches while the envelope has hits", async () => {
    const user = userEvent.setup();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "hidden");

    expect(screen.getAllByText("Hidden Oaks Cres")[0]).toBeVisible();
    expect(screen.queryByText("// NO MATCHES")).not.toBeInTheDocument();
  });

  it("still shows the empty state once a real search settles on nothing", async () => {
    setSearch({ result: emptyWorkspaceSearchResult(), activeQuery: "zzqzqzqx" });
    const user = userEvent.setup();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "zzqzqzqx");

    await waitFor(() => {
      expect(screen.getByText("// NO MATCHES")).toBeVisible();
    });
    expect(
      screen.getByText("Try fewer words, a phone number, or a document number.")
    ).toBeVisible();
    expect(screen.queryByText("Hidden Oaks Cres")).not.toBeInTheDocument();
  });

  it("holds the empty state back while the search is still in flight", async () => {
    setSearch({
      result: emptyWorkspaceSearchResult(),
      activeQuery: "zzqzqzqx",
      isFetching: true,
    });
    const user = userEvent.setup();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "zzqzqzqx");

    expect(screen.queryByText("// NO MATCHES")).not.toBeInTheDocument();
  });

  it("shows commands only below two characters — no empty state, no request", async () => {
    setSearch({ result: null, activeQuery: "h", enabled: false });
    const user = userEvent.setup();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "h");

    expect(screen.queryByText("// NO MATCHES")).not.toBeInTheDocument();
    expect(screen.queryByText("// SEARCH UNAVAILABLE")).not.toBeInTheDocument();
  });

  it("keeps the previous rows on screen while the next query loads", async () => {
    setSearch({ isFetching: true, isPlaceholderData: true, activeQuery: "hidden o" });
    const user = userEvent.setup();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "hidden o");

    expect(screen.getAllByText("Hidden Oaks Cres")[0]).toBeVisible();
  });

  it("drops the heading count while the rows answer the previous query", async () => {
    setSearch({ isFetching: true, isPlaceholderData: true, activeQuery: "hidden o" });
    const user = userEvent.setup();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "hidden o");

    // 12 was true of "hidden". Pairing it with "hidden o" would be a lie, and
    // OPS numbers are never wrong — the label stands alone until the count is.
    expect(headingsInDomOrder()).toContain("Projects");
    expect(headingsInDomOrder()).not.toContain("Projects · 12");
  });

  it("offers a quiet retry when the search itself fails", async () => {
    setSearch({ result: null, isError: true });
    const user = userEvent.setup();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "hidden");

    expect(screen.getByText("// SEARCH UNAVAILABLE")).toBeVisible();
    // Commands stay usable through an outage.
    expect(headingsInDomOrder()).toContain("System");

    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("never shows the empty state on top of an error", async () => {
    setSearch({ result: null, isError: true, activeQuery: "zzqzqzqx" });
    const user = userEvent.setup();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "zzqzqzqx");

    expect(screen.queryByText("// NO MATCHES")).not.toBeInTheDocument();
  });

  it("opens the project workspace when the first result is selected", async () => {
    const user = userEvent.setup();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "hidden");

    await waitFor(() => {
      expect(selectedRowText()).toContain("Hidden Oaks Cres");
    });
    await user.keyboard("{Enter}");

    expect(openProjectWindow).toHaveBeenCalledWith({
      projectId: "p1",
      mode: "viewing",
    });
  });

  it("moves the highlight down across group boundaries with ArrowDown", async () => {
    const user = userEvent.setup();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "hidden");

    expect(screen.getAllByText("Fightertown Hangars")[0]).toBeVisible();

    await user.keyboard("{ArrowDown}");

    await waitFor(() => {
      expect(selectedRowText()).toContain("Fightertown Hangars");
    });

    await user.keyboard("{Enter}");
    expect(openClientWindow).toHaveBeenCalledWith({
      clientId: "c1",
      mode: "viewing",
    });
  });

  it("opens a lead in the pipeline", async () => {
    setSearch({
      result: onlyKind("leads", {
        total: 1,
        items: [
          {
            id: "l1",
            title: "Deck rebuild",
            contact_name: "Rick Heatherly",
            stage: "quoted",
            address: null,
            updated_at: UPDATED,
          },
        ],
      }),
    });
    const user = userEvent.setup();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "deck");

    await waitFor(() => expect(selectedRowText()).toContain("Deck rebuild"));
    await user.keyboard("{Enter}");

    expect(push).toHaveBeenCalledWith("/pipeline?opportunity=l1");
  });

  it("opens a task's project — the window has no task focus today", async () => {
    setSearch({
      result: onlyKind("tasks", {
        total: 1,
        items: [
          {
            id: "t1",
            title: "Frame stairs",
            project_id: "p1",
            project_title: "Hidden Oaks Cres",
            task_type: "Framing",
            status: "active",
            updated_at: UPDATED,
          },
        ],
      }),
    });
    const user = userEvent.setup();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "stairs");

    await waitFor(() => expect(selectedRowText()).toContain("Frame stairs"));
    await user.keyboard("{Enter}");

    expect(openProjectWindow).toHaveBeenCalledWith({
      projectId: "p1",
      mode: "viewing",
    });
  });

  it("opens an invoice in Books", async () => {
    setSearch({
      result: onlyKind("documents", {
        total: 1,
        items: [
          {
            id: "i1",
            kind: "invoice",
            number: "INV-1042",
            title: "Deck rebuild",
            client_name: "Fightertown Hangars",
            total: 4812.5,
            status: "sent",
            updated_at: UPDATED,
          },
        ],
      }),
    });
    const user = userEvent.setup();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "1042");

    await waitFor(() => expect(selectedRowText()).toContain("INV-1042"));
    await user.keyboard("{Enter}");

    expect(push).toHaveBeenCalledWith("/books?segment=invoices&invoice=i1");
  });

  it("opens an estimate in Books", async () => {
    setSearch({
      result: onlyKind("documents", {
        total: 1,
        items: [
          {
            id: "e1",
            kind: "estimate",
            number: "EST-0088",
            title: "Rail upgrade",
            client_name: "Fightertown Hangars",
            total: 1200,
            status: "approved",
            updated_at: UPDATED,
          },
        ],
      }),
    });
    const user = userEvent.setup();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "0088");

    await waitFor(() => expect(selectedRowText()).toContain("EST-0088"));
    await user.keyboard("{Enter}");

    expect(push).toHaveBeenCalledWith("/books?segment=estimates&estimate=e1");
  });
});
