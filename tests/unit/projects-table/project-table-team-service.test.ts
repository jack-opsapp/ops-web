import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectTableTeamService } from "@/lib/api/services/project-table-team-service";
import { requireSupabase } from "@/lib/supabase/helpers";

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: vi.fn(),
}));

function teamMembersQueryMock(result: { data: unknown[] | null; error: null | { message: string } }) {
  const order = vi.fn(async () => result);
  const isDeletedAt = vi.fn(() => ({ order }));
  const eqActive = vi.fn(() => ({ is: isDeletedAt }));
  const eqCompany = vi.fn(() => ({ eq: eqActive }));
  const select = vi.fn(() => ({ eq: eqCompany }));
  const from = vi.fn(() => ({ select }));

  return { from, select, eqCompany, eqActive, isDeletedAt, order };
}

function projectTasksQueryMock(result: { data: unknown[] | null; error: null | { message: string } }) {
  const orderCreatedAt = vi.fn(async () => result);
  const orderDisplay = vi.fn(() => ({ order: orderCreatedAt }));
  const notCancelled = vi.fn(() => ({ order: orderDisplay }));
  const isDeletedAt = vi.fn(() => ({ not: notCancelled }));
  const eqProject = vi.fn(() => ({ is: isDeletedAt }));
  const select = vi.fn(() => ({ eq: eqProject }));
  const from = vi.fn(() => ({ select }));

  return { from, select, eqProject, isDeletedAt, notCancelled, orderDisplay, orderCreatedAt };
}

function rpcMock(result: { data: unknown; error: null | { code?: string; message: string } }) {
  return { rpc: vi.fn(async () => result) };
}

describe("ProjectTableTeamService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads active company team members from users", async () => {
    const mock = teamMembersQueryMock({
      data: [
        {
          id: "user-1",
          first_name: "Mara",
          last_name: "Silva",
          email: "mara@example.com",
          role: "crew",
          profile_image_url: "https://example.com/mara.jpg",
          user_color: "#6F94B0",
        },
      ],
      error: null,
    });
    vi.mocked(requireSupabase).mockReturnValue(mock as never);

    await expect(ProjectTableTeamService.fetchCompanyTeamMembers("company-1")).resolves.toEqual([
      {
        id: "user-1",
        name: "Mara Silva",
        email: "mara@example.com",
        role: "crew",
        profileImageUrl: "https://example.com/mara.jpg",
        userColor: "#6F94B0",
      },
    ]);

    expect(mock.from).toHaveBeenCalledWith("users");
    expect(mock.eqCompany).toHaveBeenCalledWith("company_id", "company-1");
    expect(mock.eqActive).toHaveBeenCalledWith("is_active", true);
    expect(mock.isDeletedAt).toHaveBeenCalledWith("deleted_at", null);
  });

  it("normalizes legacy protocol-relative team member image urls", async () => {
    const mock = teamMembersQueryMock({
      data: [
        {
          id: "user-1",
          first_name: "Mara",
          last_name: "Silva",
          email: "mara@example.com",
          role: "crew",
          profile_image_url: "//21f8aef8a1eb969e43f8925ea58a2f93.cdn.bubble.io/avatar.png",
          user_color: null,
        },
      ],
      error: null,
    });
    vi.mocked(requireSupabase).mockReturnValue(mock as never);

    await expect(ProjectTableTeamService.fetchCompanyTeamMembers("company-1")).resolves.toEqual([
      expect.objectContaining({
        profileImageUrl: "https://21f8aef8a1eb969e43f8925ea58a2f93.cdn.bubble.io/avatar.png",
      }),
    ]);
  });

  it("reads non-deleted non-cancelled project tasks ordered by display order", async () => {
    const mock = projectTasksQueryMock({
      data: [
        {
          id: "task-1",
          custom_title: "Measure roof",
          status: "active",
          start_date: "2026-05-13",
          end_date: "2026-05-14",
          team_member_ids: ["user-1"],
        },
      ],
      error: null,
    });
    vi.mocked(requireSupabase).mockReturnValue(mock as never);

    await expect(ProjectTableTeamService.fetchProjectTasks("project-1")).resolves.toEqual([
      {
        id: "task-1",
        title: "Measure roof",
        status: "active",
        startDate: "2026-05-13",
        endDate: "2026-05-14",
        teamMemberIds: ["user-1"],
      },
    ]);

    expect(mock.from).toHaveBeenCalledWith("project_tasks");
    expect(mock.eqProject).toHaveBeenCalledWith("project_id", "project-1");
    expect(mock.isDeletedAt).toHaveBeenCalledWith("deleted_at", null);
    expect(mock.notCancelled).toHaveBeenCalledWith("status", "in", "(cancelled,Cancelled)");
    expect(mock.orderDisplay).toHaveBeenCalledWith("display_order", {
      ascending: true,
      nullsFirst: false,
    });
  });

  it("creates the first assignment task through the RPC", async () => {
    const mock = rpcMock({
      data: { task_id: "task-1", updated_at: "2026-05-13T01:00:00Z" },
      error: null,
    });
    vi.mocked(requireSupabase).mockReturnValue(mock as never);

    await expect(ProjectTableTeamService.createFirstTask({
      projectId: "project-1",
      title: "Assign crew",
      expectedUpdatedAt: "2026-05-13T00:00:00Z",
    })).resolves.toEqual({
      taskId: "task-1",
      updatedAt: "2026-05-13T01:00:00Z",
    });

    expect(mock.rpc).toHaveBeenCalledWith("create_project_table_assignment_task", {
      p_project_id: "project-1",
      p_title: "Assign crew",
      p_expected_updated_at: "2026-05-13T00:00:00Z",
    });
  });

  it("assigns team members through assign_project_team_member", async () => {
    const mock = rpcMock({
      data: { updated_at: "2026-05-13T01:00:00Z" },
      error: null,
    });
    vi.mocked(requireSupabase).mockReturnValue(mock as never);

    await expect(ProjectTableTeamService.assignTeamMember({
      projectId: "project-1",
      userId: "user-1",
      taskIds: ["task-1", "task-2"],
      expectedUpdatedAt: "2026-05-13T00:00:00Z",
    })).resolves.toEqual({ updatedAt: "2026-05-13T01:00:00Z" });

    expect(mock.rpc).toHaveBeenCalledWith("assign_project_team_member", {
      p_project_id: "project-1",
      p_user_id: "user-1",
      p_task_ids: ["task-1", "task-2"],
      p_expected_updated_at: "2026-05-13T00:00:00Z",
    });
  });

  it("removes all task assignments by passing p_task_ids null", async () => {
    const mock = rpcMock({
      data: { updated_at: "2026-05-13T01:00:00Z" },
      error: null,
    });
    vi.mocked(requireSupabase).mockReturnValue(mock as never);

    await expect(ProjectTableTeamService.removeTeamMember({
      projectId: "project-1",
      userId: "user-1",
      taskIds: null,
      expectedUpdatedAt: "2026-05-13T00:00:00Z",
    })).resolves.toEqual({ updatedAt: "2026-05-13T01:00:00Z" });

    expect(mock.rpc).toHaveBeenCalledWith("remove_project_team_member", {
      p_project_id: "project-1",
      p_user_id: "user-1",
      p_task_ids: null,
      p_expected_updated_at: "2026-05-13T00:00:00Z",
    });
  });

  it("normalizes RPC failures to project table mutation errors", async () => {
    const mock = rpcMock({
      data: null,
      error: { code: "P0001", message: "project conflict" },
    });
    vi.mocked(requireSupabase).mockReturnValue(mock as never);

    await expect(ProjectTableTeamService.assignTeamMember({
      projectId: "project-1",
      userId: "user-1",
      taskIds: ["task-1"],
      expectedUpdatedAt: "2026-05-13T00:00:00Z",
    })).rejects.toMatchObject({
      name: "ProjectTableMutationError",
      code: "P0001",
      message: "project conflict",
    });
  });
});
