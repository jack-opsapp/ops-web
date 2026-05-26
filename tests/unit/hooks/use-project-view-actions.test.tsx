import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProjectTableViewMutationError,
  ProjectViewsService,
} from "@/lib/api/services/project-views-service";
import { queryKeys } from "@/lib/api/query-client";
import { useProjectViewActions } from "@/lib/hooks/projects-table/use-project-view-actions";
import {
  PROJECT_VIEW_STORAGE_KEY,
  useProjectView,
} from "@/lib/hooks/projects-table/use-project-view";
import { useTableZoom } from "@/lib/hooks/projects-table/use-table-zoom";
import type { ProjectTableViewDefinition } from "@/lib/types/project-table";

const routerPush = vi.fn();
const routerReplace = vi.fn();
let pathname = "/projects";
let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
  usePathname: () => pathname,
  useSearchParams: () => searchParams,
}));

vi.mock("@/lib/api/services/project-views-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/services/project-views-service")>(
    "@/lib/api/services/project-views-service",
  );
  return {
    ...actual,
    ProjectViewsService: {
      fetchViews: vi.fn(),
      createPersonalView: vi.fn(),
      duplicateView: vi.fn(),
      renameView: vi.fn(),
      archiveView: vi.fn(),
      resetDefaultView: vi.fn(),
      shareViewWithTeam: vi.fn(),
      updateViewDefinition: vi.fn(),
    },
  };
});

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: Object.assign(
    (selector: (state: { company: { id: string }; currentUser: { id: string } }) => unknown) =>
      selector({ company: { id: "company-1" }, currentUser: { id: "user-1" } }),
    {
      getState: () => ({ company: { id: "company-1" }, currentUser: { id: "user-1" } }),
    },
  ),
}));

let canManageViews = true;

vi.mock("@/lib/store/permissions-store", () => ({
  usePermissionStore: Object.assign(
    (selector: (state: { can: (permission: string, scope?: string) => boolean }) => unknown) =>
      selector({
        can: (permission: string, scope?: string) =>
          permission === "projects.manage_views" && scope === "all" && canManageViews,
      }),
    {
      getState: () => ({
        can: (permission: string, scope?: string) =>
          permission === "projects.manage_views" && scope === "all" && canManageViews,
      }),
    },
  ),
}));

const views: ProjectTableViewDefinition[] = [
  {
    id: "view-active",
    name: "My Active Work",
    icon: null,
    permissionKey: null,
    columns: ["name", "status"],
    filters: {},
    sort: [],
    density: "comfortable",
    zoomLevel: 1,
    isDefault: true,
    sortPosition: 0,
    updatedAt: "2026-05-14T00:00:00Z",
    ownerType: "user",
    ownerId: "user-1",
  },
  {
    id: "view-all",
    name: "All Active",
    icon: null,
    permissionKey: null,
    columns: ["name", "client"],
    filters: {},
    sort: [],
    density: "compact",
    zoomLevel: 0.85,
    isDefault: false,
    sortPosition: 1,
    updatedAt: "2026-05-14T00:01:00Z",
    ownerType: "user",
    ownerId: "user-1",
  },
  {
    id: "view-team",
    name: "Team View",
    icon: null,
    permissionKey: null,
    columns: ["name", "team"],
    filters: {},
    sort: [],
    density: "comfortable",
    zoomLevel: 1,
    isDefault: false,
    sortPosition: 2,
    updatedAt: "2026-05-14T00:02:00Z",
    ownerType: "company",
    ownerId: "company-1",
  },
];

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function setSearch(value: string) {
  searchParams = new URLSearchParams(value);
}

describe("useProjectView URL state", () => {
  beforeEach(() => {
    routerPush.mockReset();
    routerReplace.mockReset();
    pathname = "/projects";
    setSearch("");
    window.localStorage.clear();
  });

  it("lets the view query param win over localStorage", () => {
    window.localStorage.setItem(PROJECT_VIEW_STORAGE_KEY, "view-active");
    setSearch("view=view-all");

    const { result } = renderHook(() => useProjectView(views));

    expect(result.current.activeViewId).toBe("view-all");
    expect(result.current.activeView?.name).toBe("All Active");
    expect(window.localStorage.getItem(PROJECT_VIEW_STORAGE_KEY)).toBe("view-all");
  });

  it("falls back from an inaccessible URL view, clears it with replace, and exposes unavailable state", async () => {
    window.localStorage.setItem(PROJECT_VIEW_STORAGE_KEY, "view-all");
    setSearch("view=missing-view&filter=open");

    const { result } = renderHook(() => useProjectView(views));

    expect(result.current.activeViewId).toBe("view-active");
    expect(result.current.unavailableView).toEqual({ viewId: "missing-view" });
    await waitFor(() => {
      expect(routerReplace).toHaveBeenCalledWith("/projects?view=view-active&filter=open");
    });
    expect(routerPush).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(PROJECT_VIEW_STORAGE_KEY)).toBe("view-active");
  });

  it("updates URL and localStorage while preserving unrelated query params when switching views", () => {
    setSearch("filter=open&page=2");
    const { result } = renderHook(() => useProjectView(views));

    act(() => {
      result.current.setActiveViewId("view-all");
    });

    expect(result.current.activeViewId).toBe("view-all");
    expect(routerPush).toHaveBeenCalledWith("/projects?filter=open&page=2&view=view-all");
    expect(window.localStorage.getItem(PROJECT_VIEW_STORAGE_KEY)).toBe("view-all");
  });
});

describe("useProjectViewActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canManageViews = true;
  });

  it("invalidates saved views and table rows after updating the active view definition", async () => {
    const queryClient = makeQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    vi.mocked(ProjectViewsService.updateViewDefinition).mockResolvedValue({
      ...views[0],
      updatedAt: "2026-05-14T00:03:00Z",
    });

    const { result } = renderHook(
      () =>
        useProjectViewActions({
          views,
          activeViewId: "view-active",
          setActiveViewId: vi.fn(),
        }),
      { wrapper: makeWrapper(queryClient) },
    );

    await act(async () => {
      await result.current.updateViewDefinition.mutateAsync({
        viewId: "view-active",
        definition: { density: "compact", zoomLevel: 0.85 },
      });
    });

    expect(ProjectViewsService.updateViewDefinition).toHaveBeenCalledWith({
      viewId: "view-active",
      definition: { density: "compact", zoomLevel: 0.85 },
      companyId: "company-1",
      currentUserId: "user-1",
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.projects.tableViews("company-1", "user-1"),
    });
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: queryKeys.projects.all,
        exact: false,
        predicate: expect.any(Function),
      }),
    );
  });

  it("invalidates only saved views after updating density on an inactive view", async () => {
    const queryClient = makeQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    vi.mocked(ProjectViewsService.updateViewDefinition).mockResolvedValue({
      ...views[1],
      density: "spacious",
      zoomLevel: 1.25,
      updatedAt: "2026-05-14T00:04:00Z",
    });

    const { result } = renderHook(
      () =>
        useProjectViewActions({
          views,
          activeViewId: "view-active",
          setActiveViewId: vi.fn(),
        }),
      { wrapper: makeWrapper(queryClient) },
    );

    await act(async () => {
      await result.current.updateViewDefinition.mutateAsync({
        viewId: "view-all",
        definition: { density: "spacious", zoomLevel: 1.25 },
      });
    });

    expect(ProjectViewsService.updateViewDefinition).toHaveBeenCalledWith({
      viewId: "view-all",
      definition: { density: "spacious", zoomLevel: 1.25 },
      companyId: "company-1",
      currentUserId: "user-1",
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.projects.tableViews("company-1", "user-1"),
    });
    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: queryKeys.projects.all,
        exact: false,
        predicate: expect.any(Function),
      }),
    );
  });

  it("selects My Active Work after archiving the active view", async () => {
    const queryClient = makeQueryClient();
    const setActiveViewId = vi.fn();
    vi.mocked(ProjectViewsService.archiveView).mockResolvedValue({
      ...views[1],
      isArchived: true,
    });

    const { result } = renderHook(
      () => useProjectViewActions({ views, activeViewId: "view-all", setActiveViewId }),
      { wrapper: makeWrapper(queryClient) },
    );

    await act(async () => {
      await result.current.archiveView.mutateAsync({ viewId: "view-all" });
    });

    expect(setActiveViewId).toHaveBeenCalledWith("view-active");
  });

  it("does not allow share actions when the caller cannot manage views", async () => {
    canManageViews = false;
    const queryClient = makeQueryClient();
    const { result } = renderHook(
      () =>
        useProjectViewActions({
          views,
          activeViewId: "view-active",
          setActiveViewId: vi.fn(),
        }),
      { wrapper: makeWrapper(queryClient) },
    );

    expect(result.current.canShareViews).toBe(false);
    await expect(
      result.current.shareViewWithTeam.mutateAsync({ viewId: "view-active" }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(ProjectViewsService.shareViewWithTeam).not.toHaveBeenCalled();
  });

  it("surfaces duplicate-name, permission-denied, and generic typed errors", async () => {
    const queryClient = makeQueryClient();
    vi.mocked(ProjectViewsService.renameView)
      .mockRejectedValueOnce(new ProjectTableViewMutationError("duplicate", "DUPLICATE_NAME"))
      .mockRejectedValueOnce(new ProjectTableViewMutationError("denied", "PERMISSION_DENIED"))
      .mockRejectedValueOnce(new Error("offline"));

    const { result } = renderHook(
      () =>
        useProjectViewActions({
          views,
          activeViewId: "view-active",
          setActiveViewId: vi.fn(),
        }),
      { wrapper: makeWrapper(queryClient) },
    );

    await expect(
      result.current.renameView.mutateAsync({ viewId: "view-active", name: "All Active" }),
    ).rejects.toMatchObject({ code: "DUPLICATE_NAME" });
    await waitFor(() => expect(result.current.renameView.errorCode).toBe("DUPLICATE_NAME"));
    result.current.renameView.reset();

    await expect(
      result.current.renameView.mutateAsync({ viewId: "view-active", name: "Financial" }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await waitFor(() => expect(result.current.renameView.errorCode).toBe("PERMISSION_DENIED"));
    result.current.renameView.reset();

    await expect(
      result.current.renameView.mutateAsync({ viewId: "view-active", name: "Offline" }),
    ).rejects.toMatchObject({ code: "UNKNOWN" });
    await waitFor(() => expect(result.current.renameView.errorCode).toBe("UNKNOWN"));
  });
});

describe("useTableZoom density metrics", () => {
  it.each([
    [0.85, "compact", 37, 34, 12, 11, 18, 0.85],
    [1, "comfortable", 44, 40, 14, 11, 20, 1],
    [1.25, "spacious", 55, 50, 18, 14, 25, 1.25],
  ] as const)(
    "keeps row, header, type, avatar, and column metrics locked for %s",
    (zoomLevel, density, rowHeight, headerHeight, fontSize, microFontSize, avatarSize, columnScale) => {
      const { result } = renderHook(() => useTableZoom(zoomLevel));

      expect(result.current.metrics).toMatchObject({
        zoom: zoomLevel,
        density,
        rowHeight,
        headerHeight,
        fontSize,
        microFontSize,
        avatarSize,
        columnScale,
      });
    },
  );

  it("clamps wheel and pinch zoom between 0.75 and 1.50", () => {
    const { result } = renderHook(() => useTableZoom(1));

    act(() => {
      for (let index = 0; index < 30; index += 1) {
        result.current.handleWheel({
          ctrlKey: true,
          metaKey: false,
          deltaY: 100,
          preventDefault: vi.fn(),
        } as unknown as React.WheelEvent<HTMLElement>);
      }
    });

    expect(result.current.zoom).toBe(0.75);

    act(() => {
      result.current.beginPinch(100);
      result.current.updatePinch(1000);
    });

    expect(result.current.zoom).toBe(1.5);
  });
});
