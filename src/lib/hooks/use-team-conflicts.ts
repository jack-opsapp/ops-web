"use client";

import { useQuery } from "@tanstack/react-query";
import { requireSupabase } from "@/lib/supabase/helpers";
import { useAuthStore } from "@/lib/store/auth-store";

export interface TeamConflictDate {
  date: Date;
  memberName: string;
  memberId: string;
  projectTitle: string;
  projectId: string;
  taskColor: string;
}

interface ConflictTask {
  id: string;
  project_id: string;
  start_date: string;
  end_date: string;
  task_color: string;
  team_member_ids: string[];
  projects: { title: string } | null;
}

async function fetchTeamConflicts(
  teamMemberIds: string[],
  excludeProjectId: string,
  companyId: string,
  memberNameMap: Map<string, string>
): Promise<TeamConflictDate[]> {
  const supabase = requireSupabase();

  const now = new Date();
  const rangeStart = new Date(now);
  rangeStart.setDate(rangeStart.getDate() - 60);
  const rangeEnd = new Date(now);
  rangeEnd.setDate(rangeEnd.getDate() + 60);

  const { data, error } = await supabase
    .from("project_tasks")
    .select("id, project_id, start_date, end_date, task_color, team_member_ids, projects(title)")
    .eq("company_id", companyId)
    .neq("project_id", excludeProjectId)
    .is("deleted_at", null)
    .not("status", "in", '("Completed","Cancelled")')
    .not("start_date", "is", null)
    .not("end_date", "is", null)
    .gte("end_date", rangeStart.toISOString())
    .lte("start_date", rangeEnd.toISOString())
    .overlaps("team_member_ids", teamMemberIds);

  if (error || !data) return [];

  const conflicts: TeamConflictDate[] = [];
  for (const task of data as ConflictTask[]) {
    const start = new Date(task.start_date);
    const end = new Date(task.end_date);
    const projectTitle = task.projects?.title ?? "Unknown Project";

    const overlappingMembers = teamMemberIds.filter((id) =>
      task.team_member_ids.includes(id)
    );

    for (const memberId of overlappingMembers) {
      const current = new Date(start);
      while (current <= end) {
        conflicts.push({
          date: new Date(current),
          memberName: memberNameMap.get(memberId) ?? "Team Member",
          memberId,
          projectTitle,
          projectId: task.project_id,
          taskColor: task.task_color,
        });
        current.setDate(current.getDate() + 1);
      }
    }
  }

  return conflicts;
}

export function useTeamScheduleConflicts(
  teamMemberIds: string[],
  excludeProjectId: string,
  memberNameMap: Map<string, string>,
  enabled = true
) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: [
      "team-conflicts",
      teamMemberIds.sort().join(","),
      excludeProjectId,
      companyId,
    ],
    queryFn: () =>
      fetchTeamConflicts(teamMemberIds, excludeProjectId, companyId, memberNameMap),
    enabled: enabled && teamMemberIds.length > 0 && !!companyId,
    staleTime: 30_000,
  });
}
