"use client";

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { ProjectService } from "@/lib/api/services/project-service";
import { TaskService } from "@/lib/api/services/task-service";
import { UserService } from "@/lib/api/services/user-service";
import { useAuthStore } from "@/lib/store/auth-store";
import type { ProjectTask, User } from "@/lib/types/models";
import { TaskStatus } from "@/lib/types/models";

/** Compact wire shape the inbox right-rail Tasks tab consumes. */
export interface ClientTaskRow {
  id: string;
  label: string;
  /** Display name of the assignee — "You" when matched against current user, else the user's full name. */
  assignee: string;
  /** Pre-formatted due string. "TODAY 17:00" / "Apr 26" / "—". */
  due: string;
  status: "todo" | "active" | "done";
  overdue: boolean;
}

function formatDue(start: Date | null | undefined, now: Date): string {
  if (!start) return "—";
  const sameDay =
    start.getFullYear() === now.getFullYear() &&
    start.getMonth() === now.getMonth() &&
    start.getDate() === now.getDate();
  const time = start.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (sameDay) return `Today ${time}`;
  return start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function uiStatus(status: TaskStatus): "todo" | "active" | "done" {
  if (status === TaskStatus.Completed) return "done";
  if (status === TaskStatus.InProgress) return "active";
  return "todo";
}

/**
 * Returns open tasks across all projects for a client. Sorted active first,
 * then by start date ascending. Empty array when clientId is null/undefined.
 *
 * Strategy: fan out projects-then-tasks. This is N+1 by design — clients
 * typically have 1–3 active projects so the round-trip count is small.
 * The service layer caches each query independently.
 */
export function useClientTasks(
  clientId: string | null | undefined,
  queryOptions?: Partial<UseQueryOptions<ClientTaskRow[]>>,
) {
  const { currentUser, company } = useAuthStore();
  const companyId = company?.id ?? "";
  const currentUserId = currentUser?.id ?? null;

  return useQuery({
    queryKey: ["inbox", "client-tasks", companyId, clientId ?? ""] as const,
    queryFn: async (): Promise<ClientTaskRow[]> => {
      if (!clientId || !companyId) return [];

      const { projects } = await ProjectService.fetchProjects(companyId, { clientId });
      if (projects.length === 0) return [];

      const taskBatches = await Promise.all(
        projects.map((p) => TaskService.fetchProjectTasks(p.id)),
      );
      const tasks: ProjectTask[] = taskBatches.flat();

      // Resolve assignee names from teamMemberIds[0] for each task.
      const teamMemberIds = Array.from(
        new Set(
          tasks
            .map((t) => t.teamMemberIds?.[0])
            .filter((id): id is string => Boolean(id)),
        ),
      );
      const userMap = new Map<string, User>();
      if (teamMemberIds.length > 0) {
        const users = await Promise.all(
          teamMemberIds.map((id) =>
            UserService.fetchUser(id).catch(() => null),
          ),
        );
        for (const u of users) {
          if (u) userMap.set(u.id, u);
        }
      }

      const now = new Date();
      return tasks
        .filter((t) => t.status !== TaskStatus.Completed)
        .map((t): ClientTaskRow => {
          const assigneeId = t.teamMemberIds?.[0] ?? null;
          const user = assigneeId ? userMap.get(assigneeId) : null;
          const assigneeName = user
            ? `${user.firstName} ${user.lastName}`.trim() || user.email || "—"
            : "—";
          const assignee = assigneeId
            ? assigneeId === currentUserId
              ? "You"
              : assigneeName
            : "Unassigned";
          const due = formatDue(t.startDate, now);
          const overdue = !!(
            t.startDate &&
            t.startDate.getTime() < now.getTime() &&
            t.status !== TaskStatus.Completed
          );
          return {
            id: t.id,
            label: t.customTitle ?? "Task",
            assignee,
            due,
            status: uiStatus(t.status),
            overdue,
          };
        })
        .sort((a, b) => {
          // Active tasks first, then by due (overdue → soonest → no-date last)
          if (a.status !== b.status) {
            return a.status === "active" ? -1 : b.status === "active" ? 1 : 0;
          }
          if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
          return a.due.localeCompare(b.due);
        });
    },
    enabled: !!clientId && !!companyId,
    staleTime: 30_000,
    ...queryOptions,
  });
}
