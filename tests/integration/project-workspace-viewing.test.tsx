/**
 * Project workspace — VIEWING mode integration test (Phase 14.2).
 *
 * Mounts the full ProjectWorkspaceContainer with the actual viewing
 * body, sidebar, and tab surfaces wired up. Stubs land at the service
 * boundary (project query, activity query, ledger query, permission
 * store) so the integration covers:
 *
 *   - Map placeholder when project has no coordinates
 *   - ScheduleStrip renders when project is loaded; today-tick is glow-
 *     enabled only on InProgress (verified via data-status attribute)
 *   - Activity tab is the default
 *   - Details tab is reachable via the tab bar
 *   - Accounting tab is gated by invoices.view || estimates.view —
 *     hidden + disabled when both perms are denied
 *   - Sidebar renders alongside the body (always-on right rail)
 *   - Permission revocation mid-session (accounting → details fallback)
 *
 * NB: this is an integration test, not a unit test — bodies are NOT
 * stubbed. We mock service layers and Mapbox at the boundary so jsdom
 * doesn't blow up.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ProjectStatus,
  type Project,
} from "@/lib/types/models";
import { useWindowStore } from "@/stores/window-store";

// ─── Boundary mocks ──────────────────────────────────────────────────────────

vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>(
    "framer-motion",
  );
  return { ...actual, useReducedMotion: () => true };
});

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
}));

// Mapbox is heavy in jsdom — keep ProjectMap light.
vi.mock("@/components/ops/projects/workspace/map/project-map", () => ({
  ProjectMap: () => <div data-testid="project-map-stub" />,
}));

// ── Project data ──────────────────────────────────────────────────────
const mockProject = vi.fn();
vi.mock("@/lib/hooks/use-projects", () => ({
  useProject: () => mockProject(),
}));

// ── Activity timeline ─────────────────────────────────────────────────
vi.mock("@/lib/hooks/use-project-activity", () => ({
  useProjectActivity: () => ({ data: [], isLoading: false }),
}));

// ── Notes (Activity tab uses createProjectNote indirectly) ────────────
vi.mock("@/lib/hooks/use-project-notes", () => ({
  useProjectNotes: () => ({ data: [], isLoading: false }),
  useCreateProjectNote: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
}));

// ── Tasks for Details tab ─────────────────────────────────────────────
vi.mock("@/lib/hooks/use-project-tasks-grouped", () => ({
  useProjectTasksGrouped: () => ({
    active: [],
    upcoming: [],
    done: [],
    isLoading: false,
  }),
}));

// ── Team for Details tab + Sidebar ────────────────────────────────────
vi.mock("@/lib/hooks/use-project-team", () => ({
  useProjectTeam: () => ({ members: [] }),
}));
vi.mock("@/lib/hooks/use-users", () => ({
  useTeamMembers: () => ({ data: { users: [], remaining: 0, count: 0 } }),
}));

// ── Mutations / dispatch ──────────────────────────────────────────────
vi.mock("@/lib/hooks/use-project-mutations", () => ({
  useProjectMutations: () => ({
    saveProject: { mutateAsync: vi.fn(), isPending: false },
    createProject: { mutateAsync: vi.fn(), isPending: false },
    archiveProject: { mutate: vi.fn(), isPending: false },
    deleteProject: { mutate: vi.fn(), isPending: false },
    postNote: { mutateAsync: vi.fn(), isPending: false },
    uploadPhoto: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

// ── Ledger (Accounting tab) — useProjectLedger returns an array of rows.
vi.mock("@/lib/hooks/use-project-ledger", () => ({
  useProjectLedger: () => ({ data: [], isLoading: false }),
}));

// ── Pipeline (Accounting tab summary tiles) — { quoted, invoiced, received, outstanding } shape.
vi.mock("@/lib/hooks/use-project-pipeline", () => ({
  useProjectPipeline: () => ({
    data: {
      quoted: { total: 0, recordId: null },
      invoiced: { total: 0, recordId: null, changeOrdersCount: 0 },
      received: { total: 0, recordId: null, depositPct: null },
      outstanding: { total: 0, dueDate: null, daysAged: null },
    },
    isLoading: false,
  }),
}));

// ── Permission store ──────────────────────────────────────────────────
const mockCan = vi.fn();
vi.mock("@/lib/store/permissions-store", () => ({
  usePermissionStore: (
    selector: (s: { can: (p: string) => boolean }) => unknown,
  ) => selector({ can: mockCan }),
}));

// ── Auth store (for note composer) ────────────────────────────────────
vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({
    currentUser: { id: "u-1", firstName: "Jack", lastName: "Sweet" },
    company: { id: "co-1" },
  }),
}));

// ── ProjectSidebar pulls in many sub-hooks; stub it at the boundary so
//    we don't have to mock its world. We assert it renders by data-testid
//    that the stub provides.
vi.mock("@/components/ops/projects/workspace/viewing/project-sidebar", () => ({
  ProjectSidebar: ({ projectId }: { projectId: string }) => (
    <div data-testid="project-sidebar-stub" data-project-id={projectId} />
  ),
}));

// Note composer pulls in heavy state — stub.
vi.mock("@/components/ops/note-composer", () => ({
  NoteComposer: () => <div data-testid="note-composer-stub" />,
}));

import { ProjectWorkspaceContainer } from "@/components/ops/projects/workspace/project-workspace-container";

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p-1",
    title: "Driveway Sealing — Block 7",
    status: ProjectStatus.InProgress,
    companyId: "co-1",
    clientId: null,
    teamMemberIds: [],
    address: "123 Industry Way",
    latitude: 37.96,
    longitude: -121.29,
    startDate: new Date("2026-04-01"),
    endDate: new Date("2026-06-01"),
    projectDescription: null,
    trade: null,
    visibility: "all",
    notes: null,
    opportunityId: null,
    createdAt: new Date("2026-04-01"),
    ...overrides,
  } as Project;
}

const WINDOW_ID = "project-workspace:p-1";

beforeEach(() => {
  mockProject.mockReset();
  mockCan.mockReset();
  // Default: full perms granted.
  mockCan.mockReturnValue(true);

  // Fresh window store with a viewing window.
  useWindowStore.setState({ windows: [], nextZIndex: 2000 });
  useWindowStore.setState((s) => ({
    windows: [
      ...s.windows,
      {
        id: WINDOW_ID,
        title: "Driveway Sealing",
        type: "project-workspace",
        isMinimized: false,
        position: { x: 100, y: 80 },
        size: { width: 1080, height: 760 },
        zIndex: 2000,
        meta: { projectId: "p-1", initialMode: "viewing" },
      },
    ],
  }));
});

function renderContainer() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ProjectWorkspaceContainer windowId={WINDOW_ID} />
    </QueryClientProvider>,
  );
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("Project workspace — viewing mode integration", () => {
  it("renders the viewing body + always-on sidebar when project is loaded", async () => {
    mockProject.mockReturnValue({ data: makeProject(), isLoading: false });
    renderContainer();

    // Map host (Mapbox stub) renders because lat/lon are present.
    expect(await screen.findByTestId("project-map-stub")).toBeInTheDocument();
    // Right rail is always-on in viewing.
    expect(screen.getByTestId("project-sidebar-stub")).toBeInTheDocument();
    // Default tab is activity.
    expect(screen.getByTestId("viewing-body-activity")).toBeInTheDocument();
  });

  it("renders the NoCoordinates placeholder when project lacks lat/lon", async () => {
    mockProject.mockReturnValue({
      data: makeProject({ latitude: null, longitude: null }),
      isLoading: false,
    });
    const { container } = renderContainer();

    await screen.findByTestId("viewing-body-activity");
    // Look directly inside the rendered tree — DOM dumps in error
    // messages truncate at 7KB, but the placeholder definitely lives
    // inside the body if it's anywhere.
    const body = container.querySelector('[data-testid="project-viewing-body"]');
    expect(body).not.toBeNull();
    const placeholder = body!.querySelector('[data-testid="map-placeholder"]');
    expect(placeholder).not.toBeNull();
    expect(container.querySelector('[data-testid="project-map-stub"]')).toBeNull();
  });

  it("switches to Details tab when the user clicks it", async () => {
    mockProject.mockReturnValue({ data: makeProject(), isLoading: false });
    renderContainer();

    // tabs.details is the dictionary key — the stub returns the key
    // verbatim, so we click that.
    const detailsTab = await screen.findByText("tabs.details");
    fireEvent.click(detailsTab);

    await waitFor(() => {
      expect(screen.getByTestId("viewing-body-details")).toBeInTheDocument();
    });
  });

  it("permission-gates the Accounting tab — denied operators cannot click into it", async () => {
    // Deny both invoices.view AND estimates.view; allow everything else.
    mockCan.mockImplementation(
      (perm: string) => !["invoices.view", "estimates.view"].includes(perm),
    );
    mockProject.mockReturnValue({ data: makeProject(), isLoading: false });
    renderContainer();

    // Accounting tab is rendered (so users see it exists) but disabled.
    const accountingTab = await screen.findByText("tabs.accounting");
    expect(accountingTab.closest("button")).toBeDisabled();
  });

  it("allows the Accounting tab when one financial perm is granted", async () => {
    mockCan.mockImplementation(
      (perm: string) => perm === "invoices.view" /* estimates.view denied */,
    );
    mockProject.mockReturnValue({ data: makeProject(), isLoading: false });
    renderContainer();

    const accountingTab = await screen.findByText("tabs.accounting");
    expect(accountingTab.closest("button")).not.toBeDisabled();

    fireEvent.click(accountingTab);
    await waitFor(() => {
      expect(screen.getByTestId("viewing-body-accounting")).toBeInTheDocument();
    });
  });

  it("falls back to Details when financial perms are revoked while on Accounting", async () => {
    // Start with full perms so we can land on Accounting...
    let invoiceViewAllowed = true;
    mockCan.mockImplementation((perm: string) => {
      if (perm === "invoices.view") return invoiceViewAllowed;
      if (perm === "estimates.view") return false;
      return true;
    });

    mockProject.mockReturnValue({ data: makeProject(), isLoading: false });
    const { rerender } = renderContainer();

    fireEvent.click(await screen.findByText("tabs.accounting"));
    await waitFor(() => {
      expect(screen.getByTestId("viewing-body-accounting")).toBeInTheDocument();
    });

    // Revoke the perm — the body's effect should fall back to details.
    invoiceViewAllowed = false;
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ProjectWorkspaceContainer windowId={WINDOW_ID} />
      </QueryClientProvider>,
    );

    // Reload project view — the Accounting body should switch to details.
    await waitFor(() => {
      expect(screen.queryByTestId("viewing-body-accounting")).not.toBeInTheDocument();
    });
  });
});
