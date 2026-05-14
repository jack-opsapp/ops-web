import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyticsService } from "@/lib/analytics/analytics-service";
import { queryKeys } from "@/lib/api/query-client";
import { dispatchProjectAssignment } from "@/lib/api/services/notification-dispatch";
import { ProjectTableTeamService } from "@/lib/api/services/project-table-team-service";
import { ProjectTableMutationError } from "@/lib/api/services/project-table-service";
import { useProjectTableTeam } from "@/lib/hooks/projects-table/use-project-table-team";
import { ProjectStatus } from "@/lib/types/models";
import type { ProjectTableRow } from "@/lib/types/project-table";

vi.mock("@/lib/api/services/project-table-team-service", () => ({
  ProjectTableTeamService: {
    fetchCompanyTeamMembers: vi.fn(),
    fetchProjectTasks: vi.fn(),
    createFirstTask: vi.fn(),
    assignTeamMember: vi.fn(),
    removeTeamMember: vi.fn(),
  },
}));

vi.mock("@/lib/api/services/notification-dispatch", () => ({
  dispatchProjectAssignment: vi.fn(),
}));

vi.mock("@/lib/analytics/analytics-service", () => ({
  analyticsService: {
    track: vi.fn(),
  },
}));

const row: ProjectTableRow = {
  id: "project-1",
  companyId: "company-1",
  title: "Deck rebuild",
  status: ProjectStatus.Accepted,
  rawStatus: "accepted",
  clientId: null,
  clientName: null,
  clientEmail: null,
  clientPhone: null,
  address: null,
  teamMemberIds: ["user-1"],
  startDate: null,
  endDate: null,
  duration: null,
  progress: null,
  nextTask: null,
  taskCount: 1,
  taskCompletedCount: 0,
  daysInStatus: null,
  estimateTotal: null,
  invoiceTotal: null,
  paidTotal: null,
  value: null,
  projectCost: null,
  margin: null,
  photoCount: 0,
  updatedAt: "2026-05-13T00:00:00Z",
};

type InfiniteRowsData = {
  pages: Array<{ rows: ProjectTableRow[]; count: number; nextPage: number | null }>;
  pageParams: number[];
};

const tableRowsKey = queryKeys.projects.tableRows({ companyId: "company-1", viewId: "view-1" });

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

function seedTableRows(queryClient: QueryClient) {
  queryClient.setQueryData<InfiniteRowsData>(tableRowsKey, {
    pages: [{ rows: [row], count: 1, nextPage: null }],
    pageParams: [0],
  });
}

describe("useProjectTableTeam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ProjectTableTeamService.fetchCompanyTeamMembers).mockResolvedValue([
      {
        id: "user-1",
        name: "Mara Silva",
        email: "mara@example.com",
        role: "crew",
        profileImageUrl: null,
        userColor: "#6F94B0",
      },
      {
        id: "user-2",
        name: "Owen Vale",
        email: "owen@example.com",
        role: "operator",
        profileImageUrl: null,
        userColor: "#9DB582",
      },
    ]);
    vi.mocked(ProjectTableTeamService.fetchProjectTasks).mockResolvedValue([
      {
        id: "task-1",
        title: "Measure roof",
        status: "active",
        startDate: null,
        endDate: null,
        teamMemberIds: ["user-1"],
      },
    ]);
    vi.mocked(ProjectTableTeamService.assignTeamMember).mockResolvedValue({
      updatedAt: "2026-05-13T01:00:00Z",
    });
    vi.mocked(ProjectTableTeamService.removeTeamMember).mockResolvedValue({
      updatedAt: "2026-05-13T01:00:00Z",
    });
    vi.mocked(ProjectTableTeamService.createFirstTask).mockResolvedValue({
      taskId: "task-2",
      updatedAt: "2026-05-13T01:00:00Z",
    });
  });

  it("derives assigned and available members from the row team member ids", async () => {
    const queryClient = makeQueryClient();

    const { result } = renderHook(() => useProjectTableTeam({ row }), {
      wrapper: makeWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.teamMembersQuery.isSuccess).toBe(true));

    expect(ProjectTableTeamService.fetchCompanyTeamMembers).toHaveBeenCalledWith("company-1");
    expect(ProjectTableTeamService.fetchProjectTasks).toHaveBeenCalledWith("project-1");
    expect(result.current.assignedMembers.map((member) => member.id)).toEqual(["user-1"]);
    expect(result.current.availableMembers.map((member) => member.id)).toEqual(["user-2"]);
  });

  it("refuses assignment with empty task ids before calling the RPC", async () => {
    const queryClient = makeQueryClient();

    const { result } = renderHook(() => useProjectTableTeam({ row }), {
      wrapper: makeWrapper(queryClient),
    });

    await expect(
      result.current.assignTeamMember.mutateAsync({ userId: "user-2", taskIds: [] }),
    ).rejects.toMatchObject({
      name: "ProjectTableMutationError",
      code: "22023",
    });

    expect(ProjectTableTeamService.assignTeamMember).not.toHaveBeenCalled();
  });

  it("updates table row cache and invalidates team queries after assignment", async () => {
    const queryClient = makeQueryClient();
    seedTableRows(queryClient);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useProjectTableTeam({ row }), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      await result.current.assignTeamMember.mutateAsync({
        userId: "user-2",
        taskIds: ["task-1"],
      });
    });

    expect(ProjectTableTeamService.assignTeamMember).toHaveBeenCalledWith({
      projectId: "project-1",
      userId: "user-2",
      taskIds: ["task-1"],
      expectedUpdatedAt: "2026-05-13T00:00:00Z",
    });
    expect(
      queryClient.getQueryData<InfiniteRowsData>(tableRowsKey)?.pages[0]?.rows[0],
    ).toMatchObject({
      teamMemberIds: ["user-1", "user-2"],
      updatedAt: "2026-05-13T01:00:00Z",
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.projects.tableTeam("project-1"),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.projects.tableTeamMembers("company-1"),
    });
    expect(dispatchProjectAssignment).toHaveBeenCalledWith({
      projectId: "project-1",
      projectTitle: "Deck rebuild",
      newMemberIds: ["user-2"],
      companyId: "company-1",
    });
    expect(analyticsService.track).toHaveBeenCalledWith(
      "action",
      "project_table_team_rpc",
      expect.objectContaining({
        action: "assign",
        latency_ms: expect.any(Number),
        task_count: 1,
        conflict: false,
      }),
    );
  });

  it("does not dispatch assignment notifications when the member is already on the row", async () => {
    const queryClient = makeQueryClient();

    const { result } = renderHook(() => useProjectTableTeam({ row }), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      await result.current.assignTeamMember.mutateAsync({
        userId: "user-1",
        taskIds: ["task-1"],
      });
    });

    expect(ProjectTableTeamService.assignTeamMember).toHaveBeenCalledWith({
      projectId: "project-1",
      userId: "user-1",
      taskIds: ["task-1"],
      expectedUpdatedAt: "2026-05-13T00:00:00Z",
    });
    expect(dispatchProjectAssignment).not.toHaveBeenCalled();
  });

  it("tracks team RPC conflicts without logging member details", async () => {
    const queryClient = makeQueryClient();
    vi.mocked(ProjectTableTeamService.assignTeamMember).mockRejectedValueOnce(
      new ProjectTableMutationError("project conflict", "P0001"),
    );

    const { result } = renderHook(() => useProjectTableTeam({ row }), {
      wrapper: makeWrapper(queryClient),
    });

    await expect(
      result.current.assignTeamMember.mutateAsync({ userId: "user-2", taskIds: ["task-1"] }),
    ).rejects.toMatchObject({
      code: "P0001",
    });

    expect(analyticsService.track).toHaveBeenCalledWith(
      "action",
      "project_table_team_rpc",
      expect.objectContaining({
        action: "assign",
        task_count: 1,
        conflict: true,
      }),
    );
  });

  it("creates the first assignment task with the row update token", async () => {
    const queryClient = makeQueryClient();

    const { result } = renderHook(() => useProjectTableTeam({ row }), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      await result.current.createFirstTask.mutateAsync({ title: "Assign crew" });
    });

    expect(ProjectTableTeamService.createFirstTask).toHaveBeenCalledWith({
      projectId: "project-1",
      title: "Assign crew",
      expectedUpdatedAt: "2026-05-13T00:00:00Z",
    });
  });

  it("rejects team writes when the row update token is missing", async () => {
    const queryClient = makeQueryClient();
    const staleRow = { ...row, updatedAt: null };

    const { result } = renderHook(() => useProjectTableTeam({ row: staleRow }), {
      wrapper: makeWrapper(queryClient),
    });

    await expect(
      result.current.removeTeamMember.mutateAsync({ userId: "user-1", taskIds: null }),
    ).rejects.toEqual(
      new ProjectTableMutationError("Project update token is missing", "22023"),
    );
    expect(ProjectTableTeamService.removeTeamMember).not.toHaveBeenCalled();
  });
});
