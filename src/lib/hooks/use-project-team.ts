/**
 * useProjectTeam — workspace TEAM rail.
 *
 * OPS team is flat. There is no PM concept and no subcontractor concept on
 * a project. Each member's "role label" on a project is the set of task
 * types they're assigned to (e.g. "Roofing · Framing"), computed by joining
 * tasks.team_member_ids → tasks.task_type_id → task_types_v2.display.
 *
 * Implemented as a derived useMemo over four upstream queries — no extra
 * round trip, sync-fast, reactive to upstream cache invalidation. The
 * caller's loading/error state should come from those upstream hooks
 * (useProject, useTeamMembers, useProjectTasks, useTaskTypes).
 *
 * This is the same pattern as the legacy detail page sidebar at
 * `app/(dashboard)/projects/[id]/page.tsx:389-403` — kept identical so
 * the rail behaves the same as the page it replaces.
 */

import { useMemo } from "react";
import { useProject } from "@/lib/hooks/use-projects";
import { useTeamMembers } from "@/lib/hooks/use-users";
import { useProjectTasks } from "@/lib/hooks/use-tasks";
import { useTaskTypes } from "@/lib/hooks/use-task-types";

export interface ProjectTeamMember {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  avatarColor: string;
  profileImageURL: string | null;
  /** Task type display names this member is assigned to on this project.
   *  Empty array if they're on team_member_ids but assigned to no task. */
  taskTypeNames: string[];
}

export interface UseProjectTeamResult {
  members: ProjectTeamMember[];
}

const FALLBACK_AVATAR_COLOR = "#6F94B0";

export function useProjectTeam(projectId: string | null): UseProjectTeamResult {
  const { data: project } = useProject(projectId ?? undefined);
  const { data: teamData } = useTeamMembers();
  const { data: tasks = [] } = useProjectTasks(projectId ?? undefined);
  const { data: taskTypes = [] } = useTaskTypes();

  return useMemo<UseProjectTeamResult>(() => {
    if (!projectId || !project || !teamData) return { members: [] };

    const taskTypeNameById = new Map<string, string>();
    for (const tt of taskTypes) {
      taskTypeNameById.set(tt.id, tt.display);
    }

    const assignmentsByMember = new Map<string, Set<string>>();
    for (const task of tasks) {
      if (task.deletedAt) continue;
      const typeName = taskTypeNameById.get(task.taskTypeId);
      if (!typeName) continue;
      for (const memberId of task.teamMemberIds) {
        let set = assignmentsByMember.get(memberId);
        if (!set) {
          set = new Set<string>();
          assignmentsByMember.set(memberId, set);
        }
        set.add(typeName);
      }
    }

    const userById = new Map(teamData.users.map((u) => [u.id, u]));
    const memberIds = project.teamMemberIds ?? [];

    const members: ProjectTeamMember[] = [];
    for (const id of memberIds) {
      const u = userById.get(id);
      if (!u) continue;
      const name = `${u.firstName} ${u.lastName}`.trim() || "Unknown";
      members.push({
        id: u.id,
        name,
        email: u.email,
        phone: u.phone,
        avatarColor: u.userColor ?? FALLBACK_AVATAR_COLOR,
        profileImageURL: u.profileImageURL,
        taskTypeNames: Array.from(assignmentsByMember.get(u.id) ?? []),
      });
    }

    members.sort((a, b) => a.name.localeCompare(b.name));
    return { members };
  }, [projectId, project, teamData, tasks, taskTypes]);
}
