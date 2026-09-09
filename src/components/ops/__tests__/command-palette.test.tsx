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
 * 3. cmdk re-sorts every rendered `[cmdk-item]` on each keystroke — forceMount
 *    rows included — and re-appends them into their group in score order. A
 *    forceMount row's score is fixed the moment its value is registered, i.e.
 *    when the envelope lands, so the palette's `filter` has to hand those rows
 *    a flat score or the database's ranking is decided by a fuzzy match against
 *    an opaque value.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptyWorkspaceSearchResult,
  type WorkspaceSearchResult,
} from "@/lib/types/workspace-search";

/**
 * Each keystroke re-renders the whole palette and makes cmdk re-score and
 * re-append every command item, so a multi-character query is genuinely heavy
 * render work. On a loaded machine that outruns the 5s default while the
 * assertions themselves are deterministic — the budget is the flake, not the
 * code.
 */
vi.setConfig({ testTimeout: 30_000 });

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

// Only the hook is faked. `MIN_QUERY_LENGTH` comes through untouched — the
// palette's empty-state gate has to be the same number the hook refuses to
// search below, and a mocked copy could drift from it silently.
vi.mock("@/lib/hooks/use-workspace-search", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, useWorkspaceSearch: () => searchState.current };
});

// Imported after the mocks so the component picks them up.
import { CommandPalette } from "@/components/ops/command-palette";
import { HIT_VALUE_PREFIX } from "@/components/ops/command-palette-rows";

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

/**
 * No inter-keystroke delay. The palette re-renders and cmdk re-sorts on every
 * character, so the default per-key delay makes an eight-character query
 * outrun the 5s test budget on a loaded machine.
 */
function setupUser() {
  return userEvent.setup({ delay: null });
}

function renderPalette() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const tree = () => (
    <QueryClientProvider client={queryClient}>
      <CommandPalette />
    </QueryClientProvider>
  );
  const view = render(tree());
  return {
    ...view,
    /**
     * The envelope lands for a query the operator has already typed — the real
     * sequence, and the only one that reproduces cmdk's scoring. cmdk scores an
     * item's value ONCE, when the value is first registered, against whatever
     * is in the search box at that instant; an envelope present before the
     * first keystroke gets every row scored against an empty query, which is a
     * tie no sort can disturb.
     */
    async landEnvelope(overrides: SearchStateOverrides) {
      setSearch(overrides);
      await act(async () => {
        view.rerender(tree());
      });
    },
  };
}

async function openPalette() {
  await act(async () => {
    fireEvent.keyDown(window, { key: "k", metaKey: true });
  });
  return screen.getByPlaceholderText(/search or run a command/i);
}

function headingElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[cmdk-group-heading]"));
}

/**
 * Heading text in DOM order. cmdk hides a filtered-out group with the `hidden`
 * attribute rather than unmounting it, so this reads headings the operator
 * cannot see too — pair it with `toBeVisible` whenever visibility is the claim.
 */
function headingsInDomOrder(): string[] {
  return headingElements().map((el) => (el.textContent ?? "").trim());
}

/**
 * Every `[cmdk-item]` inside the group under `heading`, in the order the
 * operator reads them. cmdk reorders rows by moving the DOM nodes themselves,
 * so DOM order IS the rendered order.
 */
function rowsInGroup(heading: string): HTMLElement[] {
  const group = headingElements()
    .find((el) => (el.textContent ?? "").trim().startsWith(heading))
    ?.closest<HTMLElement>("[cmdk-group]");
  if (!group) throw new Error(`no group headed "${heading}"`);
  return Array.from(group.querySelectorAll<HTMLElement>('[cmdk-item=""]'));
}

function selectedRowText(): string {
  return (
    document.querySelector('[cmdk-item=""][aria-selected="true"]')?.textContent ?? ""
  );
}

/**
 * The highlighted row's cmdk value. A result row's value carries
 * `HIT_VALUE_PREFIX`; a command's is its label and keywords — so this tells the
 * two apart without depending on which command happens to score highest.
 */
function selectedRowValue(): string | null {
  return (
    document
      .querySelector('[cmdk-item=""][aria-selected="true"]')
      ?.getAttribute("data-value") ?? null
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
    const user = setupUser();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "hidden");

    expect(screen.getAllByText("Hidden Oaks Cres")[0]).toBeVisible();
    expect(screen.getByText("3556 Hidden Oaks Cres")).toBeVisible();
  });

  it("renders the five kinds as groups in the app's own order", async () => {
    const user = setupUser();
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
    // And they are on screen, not merely mounted: cmdk hides a group it has
    // filtered out, which is exactly how bug fa5a9ff2 presented.
    for (const heading of headingElements().slice(0, 5)) {
      expect(heading).toBeVisible();
    }
  });

  it("counts a group's heading only when rows were left behind", async () => {
    const user = setupUser();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "hidden");

    // Clients: total 1, one row rendered — nothing withheld, so no count.
    expect(headingsInDomOrder()).toContain("Clients");
    expect(headingsInDomOrder()).not.toContain("Clients · 1");
  });

  it("shows each kind's secondary line so duplicates can be told apart", async () => {
    const user = setupUser();
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
    const user = setupUser();
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
    const user = setupUser();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "fightertown");

    expect(screen.getByText("—")).toBeVisible();
  });

  it("hides the Documents group from an operator who can see neither book", async () => {
    permissions.can = (permission: string) =>
      permission !== "invoices.view" && permission !== "estimates.view";
    const user = setupUser();
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
    const user = setupUser();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "hidden");

    expect(headingsInDomOrder()).toContain("Documents");
  });

  it("never claims no matches while the envelope has hits", async () => {
    const user = setupUser();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "hidden");

    expect(screen.getAllByText("Hidden Oaks Cres")[0]).toBeVisible();
    expect(screen.queryByText("// NO MATCHES")).not.toBeInTheDocument();
  });

  it("still shows the empty state once a real search settles on nothing", async () => {
    setSearch({ result: emptyWorkspaceSearchResult(), activeQuery: "zzqzqzqx" });
    const user = setupUser();
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
    const user = setupUser();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "zzqzqzqx");

    expect(screen.queryByText("// NO MATCHES")).not.toBeInTheDocument();
  });

  it("shows commands only below two characters — no empty state, no request", async () => {
    setSearch({ result: null, activeQuery: "h", enabled: false });
    const user = setupUser();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "h");

    expect(screen.queryByText("// NO MATCHES")).not.toBeInTheDocument();
    expect(screen.queryByText("// SEARCH UNAVAILABLE")).not.toBeInTheDocument();
  });

  it("keeps the previous rows on screen while the next query loads", async () => {
    setSearch({ isFetching: true, isPlaceholderData: true, activeQuery: "hidden o" });
    const user = setupUser();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "hidden o");

    expect(screen.getAllByText("Hidden Oaks Cres")[0]).toBeVisible();
  });

  it("drops the heading count while the rows answer the previous query", async () => {
    setSearch({ isFetching: true, isPlaceholderData: true, activeQuery: "hidden o" });
    const user = setupUser();
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
    const user = setupUser();
    renderPalette();

    const input = await openPalette();
    // A command word, so the assertion below is about the outage and not about
    // cmdk having filtered every command away.
    await user.type(input, "sign out");

    expect(screen.getByText("// SEARCH UNAVAILABLE")).toBeVisible();
    // Commands stay usable through an outage.
    expect(screen.getByText("Sign Out")).toBeVisible();

    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("never shows the empty state on top of an error", async () => {
    setSearch({ result: null, isError: true, activeQuery: "zzqzqzqx" });
    const user = setupUser();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "zzqzqzqx");

    expect(screen.queryByText("// NO MATCHES")).not.toBeInTheDocument();
  });

  it("opens the project workspace when the first result is selected", async () => {
    const user = setupUser();
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
    const user = setupUser();
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
    const user = setupUser();
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
    const user = setupUser();
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
    const user = setupUser();
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
    const user = setupUser();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "0088");

    await waitFor(() => expect(selectedRowText()).toContain("EST-0088"));
    await user.keyboard("{Enter}");

    expect(push).toHaveBeenCalledWith("/books?segment=estimates&estimate=e1");
  });
});

describe("CommandPalette — the database's ranking survives cmdk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissions.can = () => true;
  });

  /** Titles in the order `search_workspace` ranked them, against three ids. */
  function rankedProjects(ids: [string, string, string]): WorkspaceSearchResult {
    const titles = ["Alpha shed", "Beta fence", "Hidden Oaks Cres"];
    const addresses = ["12 Ranger Rd", "34 Falcon Way", "3556 Oaks Cres"];
    return onlyKind("projects", {
      total: 3,
      items: ids.map((id, index) => ({
        id,
        title: titles[index],
        address: addresses[index],
        status: "in_progress",
        client_name: "Fightertown Hangars",
        updated_at: UPDATED,
      })),
    });
  }

  /** The rows the operator reads, top to bottom, inside the Projects group. */
  function projectRowOrder(): string[] {
    return rowsInGroup("Projects").map((row) => row.textContent ?? "");
  }

  function expectServerOrder(rows: string[]) {
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("Alpha shed");
    expect(rows[1]).toContain("Beta fence");
    expect(rows[2]).toContain("Hidden Oaks Cres");
  }

  /**
   * Only the last title contains the query. The row's cmdk value carries no
   * title — that is the point of `hitValue` — so nothing the operator can read
   * reaches the scorer, and the database's order stands. Put a title back into
   * the value and this row jumps the queue.
   */
  it("does not hoist the row whose title matches the query", async () => {
    setSearch({ result: emptyWorkspaceSearchResult(), activeQuery: "hidden", isFetching: true });
    const user = setupUser();
    const palette = renderPalette();

    const input = await openPalette();
    await user.type(input, "hidden");
    await palette.landEnvelope({
      result: rankedProjects([
        "77ccbbaa-eeff-4aaa-8ccc-bbbbeeeeffff",
        "88ffeecc-bbaa-4fff-9eee-ccccaaaabbbb",
        "1b0c4d2e-aaaa-4bbb-8ccc-ddddeeeeffff",
      ]),
      activeQuery: "hidden",
    });

    await waitFor(() => expectServerOrder(projectRowOrder()));
  });

  /**
   * What is left in the value — `<prefix> project <uuid>` — is still scoreable,
   * and a UUID is hex: a numeric fragment an operator types to find a document
   * or a lot number can be a subsequence of one row's id and not another's.
   * `1042` scores 0 / 0 / 0.004 across these three, so without the palette's
   * flat score the third row is hoisted for a reason nothing on screen
   * explains. This is the assertion that fails when `filter={paletteFilter}`
   * comes off the dialog.
   */
  it("does not hoist the row whose id happens to match the query", async () => {
    setSearch({ result: emptyWorkspaceSearchResult(), activeQuery: "1042", isFetching: true });
    const user = setupUser();
    const palette = renderPalette();

    const input = await openPalette();
    await user.type(input, "1042");
    await palette.landEnvelope({
      result: rankedProjects([
        "77ccbbaa-eeff-4aaa-8ccc-bbbbeeeeffff",
        "88ffeecc-bbaa-4fff-9eee-ccccaaaabbbb",
        // 1, 0, 4, 2 in order — the only one of the three "1042" matches.
        "1b0c4d2e-aaaa-4bbb-8ccc-ddddeeeeffff",
      ]),
      activeQuery: "1042",
    });

    await waitFor(() => expectServerOrder(projectRowOrder()));
  });
});

describe("CommandPalette — search-in-flight cue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissions.can = () => true;
    setSearch();
  });

  function glyph(): HTMLElement {
    const element = document.querySelector<HTMLElement>("[data-searching]");
    if (!element) throw new Error("search glyph not rendered");
    return element;
  }

  it("dims the search glyph while a query is in flight", async () => {
    setSearch({ isFetching: true, isPlaceholderData: true });
    const user = setupUser();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "hidden");

    expect(glyph()).toHaveAttribute("data-searching", "true");
    expect(glyph().getAttribute("class")).toContain("text-text-mute");
  });

  it("restores the glyph once the search settles", async () => {
    const user = setupUser();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "hidden");

    expect(glyph()).toHaveAttribute("data-searching", "false");
    expect(glyph().getAttribute("class")).toContain("text-text-3");
  });

  it("carries the design system's easing and honours reduced motion", async () => {
    const user = setupUser();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "hidden");

    const className = glyph().getAttribute("class") ?? "";
    expect(className).toContain("transition-colors");
    expect(className).toContain("duration-200");
    // `ease-smooth` is the tailwind token for cubic-bezier(0.22, 1, 0.36, 1).
    expect(className).toContain("ease-smooth");
    expect(className).toContain("motion-reduce:transition-none");
  });

  it("leaves the glyph alone while the palette is not searching", async () => {
    setSearch({ result: null, activeQuery: "h", enabled: false, isFetching: false });
    const user = setupUser();
    renderPalette();

    const input = await openPalette();
    await user.type(input, "h");

    expect(glyph()).toHaveAttribute("data-searching", "false");
  });
});

/**
 * The palette answers a question the operator asked mid-keystroke. cmdk anchors
 * the highlight the instant the search text changes — which is 150 ms of
 * debounce plus a round trip BEFORE the answer exists, so it anchors on a
 * command and never looks again (`selectFirstItem` is scheduled from the search
 * change and from item registration, and forceMount rows never register).
 * Enter then ran a navigation command while the operator was looking at the job
 * they searched for. These tests hold the envelope back the way the network
 * does — an in-flight state first, `landEnvelope` second — because a fixture
 * that is already on screen when the first key lands never reproduces it.
 */
describe("CommandPalette — the highlight follows the results", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissions.can = () => true;
    setSearch();
  });

  it("highlights the first result when the envelope lands after the keystroke", async () => {
    setSearch({ result: emptyWorkspaceSearchResult(), activeQuery: "hidden", isFetching: true });
    const user = setupUser();
    const palette = renderPalette();

    const input = await openPalette();
    await user.type(input, "hidden");
    await palette.landEnvelope({ result: fullEnvelope(), activeQuery: "hidden" });

    await waitFor(() => expect(selectedRowText()).toContain("Hidden Oaks Cres"));

    // No ArrowDown. The operator typed a job name and pressed Enter — that is
    // the whole interaction, and it has to open the job.
    await user.keyboard("{Enter}");
    expect(openProjectWindow).toHaveBeenCalledWith({
      projectId: "p1",
      mode: "viewing",
    });
  });

  it("leaves the highlight on a command when the search settles on nothing", async () => {
    setSearch({ result: emptyWorkspaceSearchResult(), activeQuery: "sync", isFetching: true });
    const user = setupUser();
    const palette = renderPalette();

    const input = await openPalette();
    await user.type(input, "sync");
    await palette.landEnvelope({
      result: emptyWorkspaceSearchResult(),
      activeQuery: "sync",
    });

    // Nothing was found, so cmdk's own first item is the answer and the
    // palette must not hold a result row over it. A result row would carry the
    // hit prefix; a command does not.
    await waitFor(() => expect(selectedRowValue()).not.toBeNull());
    expect(selectedRowValue()).not.toContain(HIT_VALUE_PREFIX);
    expect(selectedRowText()).not.toBe("");
  });

  it("re-anchors on the new first result after the operator moved the highlight", async () => {
    setSearch({ result: emptyWorkspaceSearchResult(), activeQuery: "hidden", isFetching: true });
    const user = setupUser();
    const palette = renderPalette();

    const input = await openPalette();
    await user.type(input, "hidden");
    await palette.landEnvelope({ result: fullEnvelope(), activeQuery: "hidden" });
    await waitFor(() => expect(selectedRowText()).toContain("Hidden Oaks Cres"));

    // The operator walks down a row. Their choice owns the highlight...
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(selectedRowText()).toContain("Fightertown Hangars"));

    // ...until they ask a different question, and the answer to that one takes
    // it back.
    await user.type(input, " stairs");
    await palette.landEnvelope({
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
      activeQuery: "hidden stairs",
    });

    await waitFor(() => expect(selectedRowText()).toContain("Frame stairs"));

    await user.keyboard("{Enter}");
    expect(openProjectWindow).toHaveBeenCalledWith({
      projectId: "p1",
      mode: "viewing",
    });
  });

  it("hands the highlight back to a command when a found query is replaced by a barren one", async () => {
    const user = setupUser();
    const palette = renderPalette();

    const input = await openPalette();
    await user.type(input, "hidden");
    await waitFor(() => expect(selectedRowText()).toContain("Hidden Oaks Cres"));

    // A different question, and this one finds nothing. The row the highlight
    // was sitting on leaves the screen a round trip after the keystroke that
    // asked — long after cmdk's own anchor last ran — so nothing but the
    // palette can put the highlight back on something real. Left alone it
    // points at a row that no longer exists and Enter does nothing.
    await user.clear(input);
    await user.type(input, "sync");
    await palette.landEnvelope({
      result: emptyWorkspaceSearchResult(),
      activeQuery: "sync",
    });

    await waitFor(() => expect(selectedRowValue()).not.toBeNull());
    expect(selectedRowValue()).not.toContain(HIT_VALUE_PREFIX);
    expect(selectedRowText()).not.toBe("");
  });
});
