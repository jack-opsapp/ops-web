import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProjectTableViewMutationError,
  ProjectViewsService,
} from "@/lib/api/services/project-views-service";
import { requireSupabase } from "@/lib/supabase/helpers";
import type { ProjectTableViewDefinition, ProjectViewDbRow } from "@/lib/types/project-table";

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: vi.fn(),
}));

const BASE_TIME = "2026-05-14T04:00:00Z";

function projectViewRow(overrides: Partial<ProjectViewDbRow> = {}): ProjectViewDbRow {
  return {
    id: "view-1",
    company_id: "company-1",
    owner_type: "user",
    owner_id: "user-1",
    name: "My View",
    icon: "table",
    description: null,
    permission_key: null,
    is_default: false,
    is_archived: false,
    sort_position: 100,
    columns: [{ id: "name" }, { id: "status" }],
    filters: { field: "status", op: "not_in", value: ["closed", "archived"] },
    sort: [{ field: "updated_at", direction: "desc" }],
    density: "comfortable",
    zoom_level: 1,
    created_at: BASE_TIME,
    updated_at: BASE_TIME,
    created_by: "user-1",
    ...overrides,
  };
}

function projectViewDefinition(
  overrides: Partial<ProjectTableViewDefinition> = {},
): ProjectTableViewDefinition {
  return {
    id: "source-view",
    name: "Source View",
    icon: "table",
    permissionKey: null,
    columns: ["name", "status"],
    filters: { field: "status", op: "not_in", value: ["closed", "archived"] },
    sort: [{ field: "updated_at", direction: "desc" }],
    density: "comfortable",
    zoomLevel: 1,
    isDefault: false,
    sortPosition: 100,
    updatedAt: BASE_TIME,
    ownerType: "user",
    ownerId: "user-1",
    ...overrides,
  };
}

function rpcSupabaseMock(result: {
  data: ProjectViewDbRow | null;
  error: null | { code?: string; message: string };
}) {
  return {
    from: vi.fn(() => {
      throw new Error("project view mutations must use RPCs");
    }),
    rpc: vi.fn(async () => result),
  };
}

describe("ProjectViewsService mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates personal views through the saved-view RPC and maps user ownership", async () => {
    const mock = rpcSupabaseMock({
      data: projectViewRow({
        id: "created-view",
        owner_type: "user",
        owner_id: "user-1",
        permission_key: null,
      }),
      error: null,
    });
    vi.mocked(requireSupabase).mockReturnValue(mock as never);

    await expect(ProjectViewsService.createPersonalView({
      name: "Crew Board",
      sourceView: projectViewDefinition(),
    })).resolves.toMatchObject({
      id: "created-view",
      ownerType: "user",
      ownerId: "user-1",
      permissionKey: null,
    });

    expect(mock.rpc).toHaveBeenCalledWith("create_project_table_view", {
      p_name: "Crew Board",
      p_source_view_id: "source-view",
      p_definition: {
        columns: [{ id: "name" }, { id: "status" }],
        filters: { field: "status", op: "not_in", value: ["closed", "archived"] },
        sort: [{ field: "updated_at", direction: "desc" }],
        density: "comfortable",
        zoom_level: 1,
      },
    });
    expect(mock.from).not.toHaveBeenCalled();
  });

  it("duplicates views by cloning a sanitized definition without arbitrary permission keys", async () => {
    const mock = rpcSupabaseMock({
      data: projectViewRow({ id: "duplicate-view", name: "Source Copy" }),
      error: null,
    });
    vi.mocked(requireSupabase).mockReturnValue(mock as never);
    const sourceView = {
      ...projectViewDefinition({
        permissionKey: "projects.view_financials",
        columns: ["name", "not_a_column" as never, "status"],
      }),
      permission_key: "projects.manage_views",
      owner_type: "company",
    } as ProjectTableViewDefinition & Record<string, unknown>;

    await ProjectViewsService.duplicateView({
      name: "Source Copy",
      sourceView,
    });

    const rpcCalls = mock.rpc.mock.calls as unknown as Array<[string, {
      p_definition: Record<string, unknown>;
    }]>;
    const payload = rpcCalls[0]?.[1];
    expect(mock.rpc).toHaveBeenCalledWith("create_project_table_view", expect.any(Object));
    expect(payload).toEqual({
      p_name: "Source Copy",
      p_source_view_id: "source-view",
      p_definition: {
        columns: [{ id: "name" }, { id: "status" }],
        filters: { field: "status", op: "not_in", value: ["closed", "archived"] },
        sort: [{ field: "updated_at", direction: "desc" }],
        density: "comfortable",
        zoom_level: 1,
      },
    });
    expect(payload.p_definition).not.toHaveProperty("permission_key");
    expect(payload.p_definition).not.toHaveProperty("owner_type");
  });

  it("renames views through the rename RPC and sends the name only", async () => {
    const mock = rpcSupabaseMock({
      data: projectViewRow({ name: "Renamed" }),
      error: null,
    });
    vi.mocked(requireSupabase).mockReturnValue(mock as never);

    await ProjectViewsService.renameView({ viewId: "view-1", name: "Renamed" });

    expect(mock.rpc).toHaveBeenCalledWith("rename_project_table_view", {
      p_view_id: "view-1",
      p_name: "Renamed",
    });
  });

  it("archives views through the archive RPC and maps the soft-delete result", async () => {
    const mock = rpcSupabaseMock({
      data: projectViewRow({ is_archived: true }),
      error: null,
    });
    vi.mocked(requireSupabase).mockReturnValue(mock as never);

    await expect(ProjectViewsService.archiveView({ viewId: "view-1" })).resolves.toMatchObject({
      id: "view-1",
      isArchived: true,
    });

    expect(mock.rpc).toHaveBeenCalledWith("archive_project_table_view", {
      p_view_id: "view-1",
    });
  });

  it("resets default views through the reset RPC without sending ownership fields", async () => {
    const mock = rpcSupabaseMock({
      data: projectViewRow({
        is_default: true,
        owner_type: "company",
        owner_id: "company-1",
        permission_key: "projects.view_financials",
        columns: [{ id: "name" }, { id: "value" }],
        sort: [{ field: "value", direction: "desc" }],
      }),
      error: null,
    });
    vi.mocked(requireSupabase).mockReturnValue(mock as never);

    await expect(ProjectViewsService.resetDefaultView({ viewId: "view-1" })).resolves.toMatchObject({
      ownerType: "company",
      ownerId: "company-1",
      permissionKey: "projects.view_financials",
      isDefault: true,
      columns: ["name", "value"],
      sort: [{ field: "value", direction: "desc" }],
    });

    expect(mock.rpc).toHaveBeenCalledWith("reset_project_table_view", {
      p_view_id: "view-1",
    });
  });

  it("requires canManageViews before sharing a view with the team", async () => {
    const mock = rpcSupabaseMock({
      data: projectViewRow({ owner_type: "company", owner_id: "company-1" }),
      error: null,
    });
    vi.mocked(requireSupabase).mockReturnValue(mock as never);

    await expect(ProjectViewsService.shareViewWithTeam({
      viewId: "view-1",
      canManageViews: false,
    })).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    expect(mock.rpc).not.toHaveBeenCalled();

    await ProjectViewsService.shareViewWithTeam({
      viewId: "view-1",
      canManageViews: true,
    });
    expect(mock.rpc).toHaveBeenCalledWith("share_project_table_view", {
      p_view_id: "view-1",
    });
  });

  it("updates only sanitized definition fields through the definition RPC", async () => {
    const mock = rpcSupabaseMock({
      data: projectViewRow({
        density: "compact",
        zoom_level: 0.85,
        columns: [{ id: "name" }],
      }),
      error: null,
    });
    vi.mocked(requireSupabase).mockReturnValue(mock as never);

    await ProjectViewsService.updateViewDefinition({
      viewId: "view-1",
      definition: {
        columns: ["name", "bad_column" as never],
        density: "compact",
        zoomLevel: 0.85,
        sort: [
          { field: "updated_at", direction: "desc" },
          { field: "bad_sort" as never, direction: "asc" },
        ],
        permission_key: "projects.manage_views",
      } as never,
    });

    expect(mock.rpc).toHaveBeenCalledWith("update_project_table_view_definition", {
      p_view_id: "view-1",
      p_definition: {
        columns: [{ id: "name" }],
        sort: [{ field: "updated_at", direction: "desc" }],
        density: "compact",
        zoom_level: 0.85,
      },
    });
  });

  it("maps duplicate-name RPC errors to a typed duplicate error", async () => {
    const mock = rpcSupabaseMock({
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });
    vi.mocked(requireSupabase).mockReturnValue(mock as never);

    await expect(ProjectViewsService.renameView({
      viewId: "view-1",
      name: "All Active",
    })).rejects.toMatchObject({
      name: "ProjectTableViewMutationError",
      code: "DUPLICATE_NAME",
    });
  });

  it.each(["42501", "PGRST301"] as const)(
    "maps %s RPC errors to a typed permission error",
    async (code) => {
      const mock = rpcSupabaseMock({
        data: null,
        error: { code, message: "permission denied" },
      });
      vi.mocked(requireSupabase).mockReturnValue(mock as never);

      await expect(ProjectViewsService.archiveView({ viewId: "view-1" })).rejects.toMatchObject({
        name: "ProjectTableViewMutationError",
        code: "PERMISSION_DENIED",
      });
    },
  );

  it("maps empty mutation results to typed permission errors", async () => {
    const mock = rpcSupabaseMock({ data: null, error: null });
    vi.mocked(requireSupabase).mockReturnValue(mock as never);

    await expect(ProjectViewsService.archiveView({ viewId: "view-1" })).rejects.toBeInstanceOf(
      ProjectTableViewMutationError,
    );
    await expect(ProjectViewsService.archiveView({ viewId: "view-1" })).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });
});
