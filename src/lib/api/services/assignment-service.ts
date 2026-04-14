/**
 * OPS Web — Assignment Service
 *
 * Sprint P2.2: Recommends team member assignments and scheduling based on
 * skills match, current workload, and calendar availability.
 *
 * Used by TaskSuggestionService to populate suggested_team_member_id on
 * proposed tasks, and by the team-availability API endpoint.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import { parseStringArray } from "@/lib/utils/parse";

// ─── Return Types ────────────────────────────────────────────────────────────

export interface AssignmentCandidate {
  userId: string;
  name: string;
  score: number;
  reason: string;
  /** Breakdown of scoring factors */
  factors: {
    skillScore: number;
    workloadScore: number;
    availabilityScore: number;
  };
}

export interface ScheduleGap {
  startDate: Date;
  endDate: Date;
}

export interface TeamMemberAvailability {
  userId: string;
  name: string;
  role: string;
  /** Number of tasks scheduled in the date range */
  scheduledTaskCount: number;
  /** Number of distinct projects in the date range */
  assignedProjectCount: number;
  /** Whether any tasks in the range overlap with the queried dates */
  hasConflicts: boolean;
  /** List of project names the member is assigned to in this range */
  projectNames: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getUserName(row: Record<string, unknown>): string {
  const first = (row.first_name as string) ?? "";
  const last = (row.last_name as string) ?? "";
  return `${first} ${last}`.trim() || "Unknown";
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const AssignmentService = {
  /**
   * Suggest the best team member for a given task type within a project.
   *
   * Scoring:
   *   - Skills match (40%): how often this person has done this task type before
   *   - Workload (35%): fewer active tasks = higher score
   *   - Availability (25%): no scheduling conflicts in the proposed window
   *
   * Returns a ranked list of candidates, best first.
   */
  async suggestAssignment(
    companyId: string,
    taskTypeId: string,
    projectId: string
  ): Promise<AssignmentCandidate[]> {
    const supabase = requireSupabase();

    // 1. Fetch all active team members
    const { data: members, error: membersErr } = await supabase
      .from("users")
      .select("id, first_name, last_name, role")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .limit(100);

    if (membersErr || !members || members.length === 0) return [];

    const memberIds = members.map((m) => m.id as string);

    // 2. Fetch historical task completions for this task type (skills match)
    const { data: historicalTasks } = await supabase
      .from("project_tasks")
      .select("team_member_ids")
      .eq("company_id", companyId)
      .eq("task_type_id", taskTypeId)
      .eq("status", "completed")
      .is("deleted_at", null)
      .limit(500);

    // Count how many times each member has completed this task type
    const completionCounts = new Map<string, number>();
    for (const task of historicalTasks ?? []) {
      const teamIds = parseStringArray(task.team_member_ids);
      for (const id of teamIds) {
        completionCounts.set(id, (completionCounts.get(id) ?? 0) + 1);
      }
    }
    const maxCompletions = Math.max(1, ...completionCounts.values());

    // 3. Fetch current active task counts (workload)
    const { data: activeTasks } = await supabase
      .from("project_tasks")
      .select("team_member_ids")
      .eq("company_id", companyId)
      .eq("status", "active")
      .is("deleted_at", null)
      .limit(1000);

    const activeTaskCounts = new Map<string, number>();
    for (const task of activeTasks ?? []) {
      const teamIds = parseStringArray(task.team_member_ids);
      for (const id of teamIds) {
        activeTaskCounts.set(id, (activeTaskCounts.get(id) ?? 0) + 1);
      }
    }
    const maxActive = Math.max(1, ...activeTaskCounts.values());

    // 4. Fetch upcoming scheduled tasks (next 14 days) for availability
    const now = new Date();
    const twoWeeksOut = new Date();
    twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);

    const { data: upcomingTasks } = await supabase
      .from("project_tasks")
      .select("team_member_ids, start_date, end_date")
      .eq("company_id", companyId)
      .eq("status", "active")
      .is("deleted_at", null)
      .not("start_date", "is", null)
      .gte("start_date", now.toISOString())
      .lte("start_date", twoWeeksOut.toISOString())
      .limit(500);

    const scheduledDays = new Map<string, number>();
    for (const task of upcomingTasks ?? []) {
      const teamIds = parseStringArray(task.team_member_ids);
      const start = task.start_date ? new Date(task.start_date as string) : null;
      const end = task.end_date ? new Date(task.end_date as string) : start;
      if (!start) continue;
      const days = end
        ? Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)))
        : 1;
      for (const id of teamIds) {
        scheduledDays.set(id, (scheduledDays.get(id) ?? 0) + days);
      }
    }
    const maxScheduledDays = Math.max(1, ...scheduledDays.values());

    // 5. Continuity bonus: members already assigned to this project get a boost
    const { data: projectTasks } = await supabase
      .from("project_tasks")
      .select("team_member_ids")
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .limit(200);

    const projectMemberIds = new Set<string>();
    for (const pt of projectTasks ?? []) {
      for (const id of parseStringArray(pt.team_member_ids)) {
        projectMemberIds.add(id);
      }
    }

    // 6. Score each member
    const candidates: AssignmentCandidate[] = members.map((m) => {
      const id = m.id as string;

      // Skills: 0-1 based on historical completions of this task type
      const skillScore = (completionCounts.get(id) ?? 0) / maxCompletions;

      // Workload: inverse — fewer active tasks = higher score
      const workloadScore = 1 - (activeTaskCounts.get(id) ?? 0) / maxActive;

      // Availability: inverse — fewer scheduled days = higher score
      const availabilityScore = 1 - (scheduledDays.get(id) ?? 0) / maxScheduledDays;

      // Continuity: small bonus for members already on the project
      const continuityBonus = projectMemberIds.has(id) ? 0.1 : 0;

      const score =
        skillScore * 0.35 + workloadScore * 0.30 + availabilityScore * 0.25 + continuityBonus;

      // Build human-readable reason
      const reasons: string[] = [];
      const completions = completionCounts.get(id) ?? 0;
      if (completions > 0) {
        reasons.push(`${completions} prior completion${completions > 1 ? "s" : ""} of this task type`);
      }
      const active = activeTaskCounts.get(id) ?? 0;
      if (active === 0) {
        reasons.push("no active tasks");
      } else {
        reasons.push(`${active} active task${active > 1 ? "s" : ""}`);
      }
      const scheduled = scheduledDays.get(id) ?? 0;
      if (scheduled === 0) {
        reasons.push("fully available next 2 weeks");
      } else {
        reasons.push(`${scheduled} day${scheduled > 1 ? "s" : ""} scheduled`);
      }
      if (projectMemberIds.has(id)) {
        reasons.push("already on this project");
      }

      return {
        userId: id,
        name: getUserName(m as Record<string, unknown>),
        score: Math.round(score * 100) / 100,
        reason: reasons.join("; "),
        factors: {
          skillScore: Math.round(skillScore * 100) / 100,
          workloadScore: Math.round(workloadScore * 100) / 100,
          availabilityScore: Math.round(availabilityScore * 100) / 100,
        },
      };
    });

    // Sort by score descending, with role-based tiebreaker:
    // operators > crew > others when scores are identical
    const ROLE_ORDER: Record<string, number> = {
      operator: 0,
      crew: 1,
      admin: 2,
      owner: 3,
      office: 4,
      unassigned: 5,
    };
    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Tiebreaker: prefer field roles (operators, crew) over office roles
      const ra = ROLE_ORDER[(members.find((m) => m.id === a.userId)?.role as string) ?? "unassigned"] ?? 5;
      const rb = ROLE_ORDER[(members.find((m) => m.id === b.userId)?.role as string) ?? "unassigned"] ?? 5;
      if (ra !== rb) return ra - rb;
      // Final tiebreaker: alphabetical by name for predictability
      return a.name.localeCompare(b.name);
    });

    return candidates;
  },

  /**
   * Find the first available scheduling gap for a team member.
   *
   * Scans the member's scheduled tasks from `afterDate` (default: tomorrow)
   * and finds the first gap of at least `durationDays`.
   * If no gap found within 30 days, returns the earliest date after existing commitments.
   */
  async findScheduleGap(
    companyId: string,
    teamMemberId: string,
    durationDays: number,
    afterDate?: Date
  ): Promise<ScheduleGap> {
    const supabase = requireSupabase();

    const start = afterDate ?? new Date();
    // Start from tomorrow if no afterDate
    if (!afterDate) {
      start.setDate(start.getDate() + 1);
      start.setHours(0, 0, 0, 0);
    }

    const searchEnd = new Date(start);
    searchEnd.setDate(searchEnd.getDate() + 30);

    // Fetch all scheduled tasks for this member in the 30-day window
    const { data: tasks } = await supabase
      .from("project_tasks")
      .select("start_date, end_date, duration")
      .eq("company_id", companyId)
      .contains("team_member_ids", [teamMemberId])
      .eq("status", "active")
      .is("deleted_at", null)
      .not("start_date", "is", null)
      .gte("start_date", start.toISOString())
      .lte("start_date", searchEnd.toISOString())
      .order("start_date", { ascending: true });

    // Build occupied date ranges
    const occupied: Array<{ start: Date; end: Date }> = [];
    for (const task of tasks ?? []) {
      const taskStart = new Date(task.start_date as string);
      const dur = (task.duration as number) ?? 1;
      const taskEnd = task.end_date
        ? new Date(task.end_date as string)
        : new Date(taskStart.getTime() + dur * 24 * 60 * 60 * 1000);
      occupied.push({ start: taskStart, end: taskEnd });
    }

    // Sort by start date
    occupied.sort((a, b) => a.start.getTime() - b.start.getTime());

    // Scan for gaps
    let cursor = new Date(start);
    for (const slot of occupied) {
      const gapDays = Math.floor(
        (slot.start.getTime() - cursor.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (gapDays >= durationDays) {
        // Found a gap
        const gapEnd = new Date(cursor);
        gapEnd.setDate(gapEnd.getDate() + durationDays);
        return { startDate: new Date(cursor), endDate: gapEnd };
      }
      // Move cursor past this occupied slot
      if (slot.end > cursor) {
        cursor = new Date(slot.end);
      }
    }

    // No gap found in existing slots — use after the last occupied slot
    const gapEnd = new Date(cursor);
    gapEnd.setDate(gapEnd.getDate() + durationDays);
    return { startDate: new Date(cursor), endDate: gapEnd };
  },

  /**
   * Get availability overview for all active team members in a date range.
   * Used by the approval queue card and team-availability API endpoint.
   */
  async getTeamAvailability(
    companyId: string,
    startDate: Date,
    endDate: Date
  ): Promise<TeamMemberAvailability[]> {
    const supabase = requireSupabase();

    // Fetch all active team members
    const { data: members, error: membersErr } = await supabase
      .from("users")
      .select("id, first_name, last_name, role")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .limit(100);

    if (membersErr || !members || members.length === 0) return [];

    // Fetch all tasks in the date range
    const { data: tasks } = await supabase
      .from("project_tasks")
      .select("id, project_id, team_member_ids, start_date, end_date, status")
      .eq("company_id", companyId)
      .eq("status", "active")
      .is("deleted_at", null)
      .not("start_date", "is", null)
      .or(
        `and(start_date.gte.${startDate.toISOString()},start_date.lte.${endDate.toISOString()}),and(end_date.gte.${startDate.toISOString()},end_date.lte.${endDate.toISOString()})`
      )
      .limit(1000);

    // Fetch project names for context
    const projectIds = new Set<string>();
    for (const task of tasks ?? []) {
      if (task.project_id) projectIds.add(task.project_id as string);
    }

    const projectNameMap = new Map<string, string>();
    if (projectIds.size > 0) {
      const ids = Array.from(projectIds);
      // Batch in chunks of 80 to avoid URL limits
      for (let i = 0; i < ids.length; i += 80) {
        const chunk = ids.slice(i, i + 80);
        const { data: projects } = await supabase
          .from("projects")
          .select("id, title")
          .in("id", chunk);
        for (const p of projects ?? []) {
          projectNameMap.set(p.id as string, p.title as string);
        }
      }
    }

    // Build per-member availability
    return members.map((m) => {
      const memberId = m.id as string;
      let scheduledTaskCount = 0;
      const assignedProjectIds = new Set<string>();

      // Collect this member's task date ranges to detect double-booking
      const memberRanges: Array<{ start: Date; end: Date }> = [];

      for (const task of tasks ?? []) {
        const teamIds = parseStringArray(task.team_member_ids);
        if (!teamIds.includes(memberId)) continue;

        scheduledTaskCount++;
        if (task.project_id) {
          assignedProjectIds.add(task.project_id as string);
        }

        const taskStart = task.start_date ? new Date(task.start_date as string) : null;
        const taskEnd = task.end_date ? new Date(task.end_date as string) : taskStart;
        if (taskStart && taskEnd) {
          memberRanges.push({ start: taskStart, end: taskEnd });
        }
      }

      // Detect actual double-booking: any two tasks that overlap in time
      let hasConflicts = false;
      for (let i = 0; i < memberRanges.length && !hasConflicts; i++) {
        for (let j = i + 1; j < memberRanges.length; j++) {
          if (memberRanges[i].start <= memberRanges[j].end && memberRanges[j].start <= memberRanges[i].end) {
            hasConflicts = true;
            break;
          }
        }
      }

      const projectNames = Array.from(assignedProjectIds)
        .map((pid) => projectNameMap.get(pid) ?? "Unknown")
        .filter(Boolean);

      return {
        userId: memberId,
        name: getUserName(m as Record<string, unknown>),
        role: (m.role as string) ?? "unassigned",
        scheduledTaskCount,
        assignedProjectCount: assignedProjectIds.size,
        hasConflicts,
        projectNames,
      };
    });
  },
};
