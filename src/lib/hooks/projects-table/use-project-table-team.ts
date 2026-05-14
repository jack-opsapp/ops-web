import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { analyticsService } from "@/lib/analytics/analytics-service";
import { queryKeys } from "@/lib/api/query-client";
import { dispatchProjectAssignment } from "@/lib/api/services/notification-dispatch";
import { ProjectTableTeamService } from "@/lib/api/services/project-table-team-service";
import { ProjectTableMutationError } from "@/lib/api/services/project-table-service";
import type { ProjectTableRow } from "@/lib/types/project-table";

type InfiniteProjectTableRowsData = {
  pages: Array<{ rows?: ProjectTableRow[] }>;
};

function isProjectTableRowsQuery(queryKey: readonly unknown[]) {
  return queryKey[0] === "projects" && queryKey[1] === "tableRows";
}

function updateProjectRows(
  queryClient: QueryClient,
  projectId: string,
  updater: (row: ProjectTableRow) => ProjectTableRow,
) {
  queryClient.setQueriesData<unknown>(
    {
      queryKey: queryKeys.projects.all,
      exact: false,
      predicate: (query) =>
        Array.isArray(query.queryKey) && isProjectTableRowsQuery(query.queryKey),
    },
    (oldData: unknown) => {
      if (!oldData || typeof oldData !== "object" || !("pages" in oldData)) return oldData;
      const data = oldData as InfiniteProjectTableRowsData;
      return {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          rows: page.rows?.map((cachedRow) =>
            cachedRow.id === projectId ? updater(cachedRow) : cachedRow,
          ),
        })),
      };
    },
  );
}

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids));
}

function requireUpdateToken(row: ProjectTableRow) {
  if (!row.updatedAt) {
    throw new ProjectTableMutationError("Project update token is missing", "22023");
  }
  return row.updatedAt;
}

function requireTaskIds(taskIds: string[]) {
  if (taskIds.length === 0) {
    throw new ProjectTableMutationError("Team assignment requires at least one task", "22023");
  }
}

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function isConflictError(error: unknown) {
  return error instanceof ProjectTableMutationError && error.code === "P0001";
}

function trackTeamRpc(args: {
  action: "assign" | "remove" | "create_first_task";
  startedAt: number;
  taskCount: number;
  conflict: boolean;
}) {
  analyticsService?.track?.("action", "project_table_team_rpc", {
    action: args.action,
    latency_ms: Math.round(nowMs() - args.startedAt),
    task_count: args.taskCount,
    conflict: args.conflict,
  });
}

function invalidateTeamCaches(queryClient: QueryClient, row: ProjectTableRow) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.projects.tableTeam(row.id) });
  void queryClient.invalidateQueries({
    queryKey: queryKeys.projects.tableTeamMembers(row.companyId),
  });
  void queryClient.invalidateQueries({
    queryKey: queryKeys.projects.all,
    exact: false,
    predicate: (query) =>
      Array.isArray(query.queryKey) && isProjectTableRowsQuery(query.queryKey),
  });
}

export function useProjectTableTeam({ row }: { row: ProjectTableRow }) {
  const queryClient = useQueryClient();

  const teamMembersQuery = useQuery({
    queryKey: queryKeys.projects.tableTeamMembers(row.companyId),
    queryFn: () => ProjectTableTeamService.fetchCompanyTeamMembers(row.companyId),
    enabled: Boolean(row.companyId),
    staleTime: 60_000,
  });

  const tasksQuery = useQuery({
    queryKey: queryKeys.projects.tableTeam(row.id),
    queryFn: () => ProjectTableTeamService.fetchProjectTasks(row.id),
    enabled: Boolean(row.id),
    staleTime: 30_000,
  });

  const assignedMemberIds = useMemo(
    () => new Set(row.teamMemberIds),
    [row.teamMemberIds],
  );

  const assignedMembers = useMemo(
    () =>
      (teamMembersQuery.data ?? []).filter((member) => assignedMemberIds.has(member.id)),
    [assignedMemberIds, teamMembersQuery.data],
  );

  const availableMembers = useMemo(
    () =>
      (teamMembersQuery.data ?? []).filter((member) => !assignedMemberIds.has(member.id)),
    [assignedMemberIds, teamMembersQuery.data],
  );

  const assignTeamMember = useMutation({
    mutationFn: async ({ userId, taskIds }: { userId: string; taskIds: string[] }) => {
      requireTaskIds(taskIds);
      const startedAt = nowMs();
      try {
        const result = await ProjectTableTeamService.assignTeamMember({
          projectId: row.id,
          userId,
          taskIds,
          expectedUpdatedAt: requireUpdateToken(row),
        });
        trackTeamRpc({
          action: "assign",
          startedAt,
          taskCount: taskIds.length,
          conflict: false,
        });
        return result;
      } catch (error) {
        trackTeamRpc({
          action: "assign",
          startedAt,
          taskCount: taskIds.length,
          conflict: isConflictError(error),
        });
        throw error;
      }
    },
    onSuccess: (result, variables) => {
      const wasAlreadyAssigned = row.teamMemberIds.includes(variables.userId);
      updateProjectRows(queryClient, row.id, (cachedRow) => ({
        ...cachedRow,
        teamMemberIds: uniqueIds([...cachedRow.teamMemberIds, variables.userId]),
        updatedAt: result.updatedAt,
      }));
      invalidateTeamCaches(queryClient, row);
      if (!wasAlreadyAssigned) {
        dispatchProjectAssignment({
          projectId: row.id,
          projectTitle: row.title,
          newMemberIds: [variables.userId],
          companyId: row.companyId,
        });
      }
    },
  });

  const removeTeamMember = useMutation({
    mutationFn: async ({
      userId,
      taskIds,
    }: {
      userId: string;
      taskIds: string[] | null;
    }) => {
      const startedAt = nowMs();
      try {
        const result = await ProjectTableTeamService.removeTeamMember({
          projectId: row.id,
          userId,
          taskIds,
          expectedUpdatedAt: requireUpdateToken(row),
        });
        trackTeamRpc({
          action: "remove",
          startedAt,
          taskCount: taskIds?.length ?? 0,
          conflict: false,
        });
        return result;
      } catch (error) {
        trackTeamRpc({
          action: "remove",
          startedAt,
          taskCount: taskIds?.length ?? 0,
          conflict: isConflictError(error),
        });
        throw error;
      }
    },
    onSuccess: (result, variables) => {
      updateProjectRows(queryClient, row.id, (cachedRow) => ({
        ...cachedRow,
        teamMemberIds:
          variables.taskIds === null
            ? cachedRow.teamMemberIds.filter((id) => id !== variables.userId)
            : cachedRow.teamMemberIds,
        updatedAt: result.updatedAt,
      }));
      invalidateTeamCaches(queryClient, row);
    },
  });

  const createFirstTask = useMutation({
    mutationFn: async ({ title }: { title: string }) => {
      const startedAt = nowMs();
      try {
        const result = await ProjectTableTeamService.createFirstTask({
          projectId: row.id,
          title,
          expectedUpdatedAt: requireUpdateToken(row),
        });
        trackTeamRpc({
          action: "create_first_task",
          startedAt,
          taskCount: 1,
          conflict: false,
        });
        return result;
      } catch (error) {
        trackTeamRpc({
          action: "create_first_task",
          startedAt,
          taskCount: 1,
          conflict: isConflictError(error),
        });
        throw error;
      }
    },
    onSuccess: (result) => {
      updateProjectRows(queryClient, row.id, (cachedRow) => ({
        ...cachedRow,
        taskCount: Math.max(cachedRow.taskCount, 1),
        updatedAt: result.updatedAt,
      }));
      invalidateTeamCaches(queryClient, row);
    },
  });

  return {
    teamMembersQuery,
    tasksQuery,
    assignedMembers,
    availableMembers,
    assignTeamMember,
    removeTeamMember,
    createFirstTask,
  };
}
