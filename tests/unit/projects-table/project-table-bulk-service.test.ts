import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectTableService } from "@/lib/api/services/project-table-service";
import { ProjectStatus } from "@/lib/types/models";
import { requireSupabase } from "@/lib/supabase/helpers";

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: vi.fn(),
}));

function rpcSupabaseMock(result: {
  data: unknown;
  error: null | { code?: string; message: string };
}) {
  return { rpc: vi.fn(async () => result) };
}

describe("ProjectTableService bulk updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls bulk_update_project_table once with serialized status operations", async () => {
    const mock = rpcSupabaseMock({
      data: {
        success: [{ project_id: "project-1", action: "status", updated_at: "2026-05-13T01:00:00Z" }],
        failed: [],
        success_count: 1,
        failed_count: 0,
      },
      error: null,
    });
    vi.mocked(requireSupabase).mockReturnValue(mock as never);

    await expect(ProjectTableService.bulkUpdateProjects({
      operations: [
        {
          action: "status",
          projectId: "project-1",
          status: ProjectStatus.InProgress,
          expectedUpdatedAt: "2026-05-13T00:00:00Z",
        },
      ],
    })).resolves.toEqual({
      success: [{ projectId: "project-1", action: "status", updatedAt: "2026-05-13T01:00:00Z" }],
      failed: [],
      successCount: 1,
      failedCount: 0,
    });

    expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect(mock.rpc).toHaveBeenCalledWith("bulk_update_project_table", {
      p_operations: [
        {
          action: "status",
          project_id: "project-1",
          status: "in_progress",
          expected_updated_at: "2026-05-13T00:00:00Z",
        },
      ],
    });
  });

  it("serializes date operations with the date action and db field name", async () => {
    const mock = rpcSupabaseMock({
      data: { success: [], failed: [], success_count: 0, failed_count: 0 },
      error: null,
    });
    vi.mocked(requireSupabase).mockReturnValue(mock as never);

    await ProjectTableService.bulkUpdateProjects({
      operations: [
        {
          action: "date",
          projectId: "project-1",
          field: "end_date",
          value: "2026-06-01",
          expectedUpdatedAt: "2026-05-13T00:00:00Z",
        },
      ],
    });

    expect(mock.rpc).toHaveBeenCalledWith("bulk_update_project_table", {
      p_operations: [
        {
          action: "date",
          project_id: "project-1",
          field: "end_date",
          value: "2026-06-01",
          expected_updated_at: "2026-05-13T00:00:00Z",
        },
      ],
    });
  });

  it("serializes assignment operations with per-project task ids", async () => {
    const mock = rpcSupabaseMock({
      data: { success: [], failed: [], success_count: 0, failed_count: 0 },
      error: null,
    });
    vi.mocked(requireSupabase).mockReturnValue(mock as never);

    await ProjectTableService.bulkUpdateProjects({
      operations: [
        {
          action: "assign_team",
          projectId: "project-1",
          userId: "user-1",
          taskIds: ["task-1", "task-2"],
          expectedUpdatedAt: "2026-05-13T00:00:00Z",
        },
      ],
    });

    expect(mock.rpc).toHaveBeenCalledWith("bulk_update_project_table", {
      p_operations: [
        {
          action: "assign_team",
          project_id: "project-1",
          user_id: "user-1",
          task_ids: ["task-1", "task-2"],
          expected_updated_at: "2026-05-13T00:00:00Z",
        },
      ],
    });
  });

  it("returns structured partial failures without throwing", async () => {
    const mock = rpcSupabaseMock({
      data: {
        success: [{ project_id: "project-1", action: "status", updated_at: "2026-05-13T01:00:00Z" }],
        failed: [{ project_id: "project-2", action: "status", code: "P0001", message: "project conflict" }],
        success_count: 1,
        failed_count: 1,
      },
      error: null,
    });
    vi.mocked(requireSupabase).mockReturnValue(mock as never);

    await expect(ProjectTableService.bulkUpdateProjects({
      operations: [
        {
          action: "status",
          projectId: "project-1",
          status: ProjectStatus.Completed,
          expectedUpdatedAt: "2026-05-13T00:00:00Z",
        },
        {
          action: "status",
          projectId: "project-2",
          status: ProjectStatus.Completed,
          expectedUpdatedAt: "2026-05-13T00:00:00Z",
        },
      ],
    })).resolves.toEqual({
      success: [{ projectId: "project-1", action: "status", updatedAt: "2026-05-13T01:00:00Z" }],
      failed: [{ projectId: "project-2", action: "status", code: "P0001", message: "project conflict" }],
      successCount: 1,
      failedCount: 1,
    });
  });

  it("throws a normalized mutation error for transport RPC failures", async () => {
    const mock = rpcSupabaseMock({
      data: null,
      error: { code: "42501", message: "permission denied" },
    });
    vi.mocked(requireSupabase).mockReturnValue(mock as never);

    await expect(ProjectTableService.bulkUpdateProjects({
      operations: [
        {
          action: "status",
          projectId: "project-1",
          status: ProjectStatus.Completed,
          expectedUpdatedAt: "2026-05-13T00:00:00Z",
        },
      ],
    })).rejects.toMatchObject({
      name: "ProjectTableMutationError",
      code: "42501",
      message: "permission denied",
    });
  });
});
