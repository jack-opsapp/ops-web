import { requireSupabase } from "@/lib/supabase/helpers";
import {
  ProjectTableMutationError,
  normalizeProjectTableMutationError,
} from "@/lib/api/services/project-table-service";

export interface ProjectTableTeamMember {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  profileImageUrl: string | null;
  userColor: string | null;
}

export interface ProjectTableTaskOption {
  id: string;
  title: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  teamMemberIds: string[];
}

interface TeamMutationParams {
  projectId: string;
  userId: string;
  taskIds: string[] | null;
  expectedUpdatedAt: string;
}

function mapTeamMember(row: Record<string, unknown>): ProjectTableTeamMember {
  const firstName = typeof row.first_name === "string" ? row.first_name.trim() : "";
  const lastName = typeof row.last_name === "string" ? row.last_name.trim() : "";
  const name = [firstName, lastName].filter(Boolean).join(" ");

  return {
    id: String(row.id),
    name: name || String(row.email ?? row.id),
    email: typeof row.email === "string" ? row.email : null,
    role: typeof row.role === "string" ? row.role : null,
    profileImageUrl: typeof row.profile_image_url === "string" ? row.profile_image_url : null,
    userColor: typeof row.user_color === "string" ? row.user_color : null,
  };
}

function mapTaskOption(row: Record<string, unknown>): ProjectTableTaskOption {
  const teamMemberIds = Array.isArray(row.team_member_ids)
    ? row.team_member_ids.filter((id): id is string => typeof id === "string")
    : [];

  return {
    id: String(row.id),
    title: typeof row.custom_title === "string" ? row.custom_title.trim() : "",
    status: typeof row.status === "string" ? row.status : "",
    startDate: typeof row.start_date === "string" ? row.start_date : null,
    endDate: typeof row.end_date === "string" ? row.end_date : null,
    teamMemberIds,
  };
}

function readUpdatedAt(data: unknown, fallbackMessage: string): string {
  const updatedAt = typeof data === "object" && data && "updated_at" in data
    ? String((data as { updated_at: unknown }).updated_at ?? "")
    : "";

  if (!updatedAt) throw new ProjectTableMutationError(fallbackMessage, "UNKNOWN");
  return updatedAt;
}

function readTaskId(data: unknown): string {
  const taskId = typeof data === "object" && data && "task_id" in data
    ? String((data as { task_id: unknown }).task_id ?? "")
    : "";

  if (!taskId) {
    throw new ProjectTableMutationError("Assignment task response missing task_id", "UNKNOWN");
  }
  return taskId;
}

export const ProjectTableTeamService = {
  async fetchCompanyTeamMembers(companyId: string): Promise<ProjectTableTeamMember[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("users")
      .select("id, first_name, last_name, email, role, profile_image_url, user_color")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("first_name", { ascending: true });

    if (error) throw new Error(`Failed to fetch company team members: ${error.message}`);
    return (data ?? []).map((row) => mapTeamMember(row as Record<string, unknown>));
  },

  async fetchProjectTasks(projectId: string): Promise<ProjectTableTaskOption[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("project_tasks")
      .select("id, custom_title, status, start_date, end_date, team_member_ids, display_order, created_at")
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .not("status", "in", "(cancelled,Cancelled)")
      .order("display_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });

    if (error) throw new Error(`Failed to fetch project tasks: ${error.message}`);
    return (data ?? []).map((row) => mapTaskOption(row as Record<string, unknown>));
  },

  async createFirstTask(params: {
    projectId: string;
    title: string;
    expectedUpdatedAt: string;
  }): Promise<{ taskId: string; updatedAt: string }> {
    const supabase = requireSupabase();
    const { data, error } = await supabase.rpc("create_project_table_assignment_task", {
      p_project_id: params.projectId,
      p_title: params.title,
      p_expected_updated_at: params.expectedUpdatedAt,
    });

    if (error) throw normalizeProjectTableMutationError(error);
    return {
      taskId: readTaskId(data),
      updatedAt: readUpdatedAt(data, "Assignment task response missing updated_at"),
    };
  },

  async assignTeamMember(params: TeamMutationParams): Promise<{ updatedAt: string }> {
    const supabase = requireSupabase();
    const { data, error } = await supabase.rpc("assign_project_team_member", {
      p_project_id: params.projectId,
      p_user_id: params.userId,
      p_task_ids: params.taskIds ?? [],
      p_expected_updated_at: params.expectedUpdatedAt,
    });

    if (error) throw normalizeProjectTableMutationError(error);
    return { updatedAt: readUpdatedAt(data, "Assign team response missing updated_at") };
  },

  async removeTeamMember(params: TeamMutationParams): Promise<{ updatedAt: string }> {
    const supabase = requireSupabase();
    const { data, error } = await supabase.rpc("remove_project_team_member", {
      p_project_id: params.projectId,
      p_user_id: params.userId,
      p_task_ids: params.taskIds,
      p_expected_updated_at: params.expectedUpdatedAt,
    } as {
      p_project_id: string;
      p_user_id: string;
      p_task_ids: string[] | null;
      p_expected_updated_at: string;
    });

    if (error) throw normalizeProjectTableMutationError(error);
    return { updatedAt: readUpdatedAt(data, "Remove team response missing updated_at") };
  },
};
