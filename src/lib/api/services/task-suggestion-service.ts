/**
 * OPS Web — Task Suggestion Service
 *
 * Sprint P2.1: Analyzes project context and suggests tasks to create.
 * Uses historical patterns, company task types, and the assignment service
 * to generate intelligent task suggestions with team member recommendations.
 *
 * All suggestions flow through the approval queue — nothing is auto-created.
 * Gated behind phase_c feature flag.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import { ApprovalQueueService } from "./approval-queue-service";
import { AssignmentService } from "./assignment-service";
import { BusinessContextService } from "./business-context-service";
import { AdminFeatureOverrideService } from "./admin-feature-override-service";
import type { CreateTaskActionData } from "@/lib/types/approval-queue";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TaskSuggestion {
  taskTypeId: string;
  taskTypeName: string;
  title: string;
  notes: string | null;
  color: string | null;
  teamMemberId: string | null;
  teamMemberName: string | null;
  startDate: string | null;
  endDate: string | null;
  duration: number | null;
  assignmentReason: string | null;
  confidence: number;
  reason: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Score how well a task type name matches a project title/description.
 * Simple keyword overlap — e.g. project "Deck Build - Smith" matches task type "Deck".
 */
function keywordMatchScore(
  projectText: string,
  taskTypeName: string
): number {
  const projectWords = projectText.toLowerCase().split(/\W+/).filter(Boolean);
  const taskWords = taskTypeName.toLowerCase().split(/\W+/).filter(Boolean);

  if (taskWords.length === 0) return 0;

  let matches = 0;
  for (const tw of taskWords) {
    if (tw.length < 3) continue; // Skip short words like "of", "in"
    if (projectWords.some((pw) => pw.includes(tw) || tw.includes(pw))) {
      matches++;
    }
  }

  return matches / taskWords.length;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const TaskSuggestionService = {
  /**
   * Analyze a project and suggest tasks based on:
   *   1. Project title/description keyword matching to task types
   *   2. Historical patterns: what task types were used in similar projects
   *   3. Company defaults: default task types always suggested with lower confidence
   *
   * Each suggestion includes a recommended team member and schedule gap.
   */
  async suggestTasksForProject(
    companyId: string,
    projectId: string
  ): Promise<TaskSuggestion[]> {
    const supabase = requireSupabase();

    // Gate behind phase_c feature flag
    const enabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      companyId,
      "phase_c"
    );
    if (!enabled) {
      console.log(`[task-suggestion] Phase C disabled for ${companyId}, skipping`);
      return [];
    }

    // Fetch project context
    const projectCtx = await BusinessContextService.getProjectContext(
      companyId,
      projectId
    );

    if (!projectCtx.found || !projectCtx.title) {
      console.log(`[task-suggestion] Project ${projectId} not found`);
      return [];
    }

    // Fetch company's task types
    const { data: taskTypes } = await supabase
      .from("task_types")
      .select("id, display, color, is_default, default_team_member_ids")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .limit(50);

    if (!taskTypes || taskTypes.length === 0) {
      console.log(`[task-suggestion] No task types for company ${companyId}`);
      return [];
    }

    // Check what task type IDs already exist on this project (avoid duplicates)
    const { data: existingTasks } = await supabase
      .from("project_tasks")
      .select("task_type_id")
      .eq("project_id", projectId)
      .eq("company_id", companyId)
      .is("deleted_at", null);

    const existingTaskTypeIds = new Set(
      (existingTasks ?? []).map((t) => t.task_type_id as string).filter(Boolean)
    );

    // Fetch historical task patterns: for completed projects, what task types were used?
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

    const { data: historicalTasks } = await supabase
      .from("project_tasks")
      .select("task_type_id, project_id")
      .eq("company_id", companyId)
      .neq("project_id", projectId)
      .in("status", ["active", "completed"])
      .is("deleted_at", null)
      .gte("created_at", twelveMonthsAgo.toISOString())
      .limit(2000);

    // Count task type frequency across projects
    const taskTypeFrequency = new Map<string, number>();
    const projectsWithType = new Map<string, Set<string>>();
    for (const ht of historicalTasks ?? []) {
      const ttId = ht.task_type_id as string;
      if (!ttId) continue;
      taskTypeFrequency.set(ttId, (taskTypeFrequency.get(ttId) ?? 0) + 1);
      if (!projectsWithType.has(ttId)) projectsWithType.set(ttId, new Set());
      projectsWithType.get(ttId)!.add(ht.project_id as string);
    }

    // Build project text for keyword matching
    const projectText = [
      projectCtx.title,
      projectCtx.description,
      projectCtx.client?.name,
    ]
      .filter(Boolean)
      .join(" ");

    // Score each task type
    const scored: Array<{
      id: string;
      display: string;
      color: string;
      isDefault: boolean;
      defaultTeamMemberIds: string[];
      keywordScore: number;
      historyScore: number;
      totalScore: number;
    }> = [];

    const maxFreq = Math.max(1, ...taskTypeFrequency.values());

    for (const tt of taskTypes) {
      const ttId = tt.id as string;
      const display = tt.display as string;

      // Skip if this task type already exists on the project
      if (existingTaskTypeIds.has(ttId)) continue;

      const keywordScore = keywordMatchScore(projectText, display);
      const historyScore = (taskTypeFrequency.get(ttId) ?? 0) / maxFreq;
      const isDefault = (tt.is_default as boolean) ?? false;

      // Weighted combination
      const totalScore =
        keywordScore * 0.5 +
        historyScore * 0.3 +
        (isDefault ? 0.2 : 0);

      scored.push({
        id: ttId,
        display,
        color: (tt.color as string) ?? "#417394",
        isDefault,
        defaultTeamMemberIds: (tt.default_team_member_ids as string[]) ?? [],
        keywordScore,
        historyScore,
        totalScore,
      });
    }

    // Sort by score and take top suggestions
    scored.sort((a, b) => b.totalScore - a.totalScore);

    // Take task types that scored above threshold, or defaults as fallback
    const SCORE_THRESHOLD = 0.1;
    let selected = scored.filter((s) => s.totalScore >= SCORE_THRESHOLD);
    if (selected.length === 0) {
      // Fallback: suggest default task types
      selected = scored.filter((s) => s.isDefault).slice(0, 3);
    }
    // Cap at 8 suggestions
    selected = selected.slice(0, 8);

    // Enrich each suggestion with assignment and scheduling
    const suggestions: TaskSuggestion[] = [];

    for (const tt of selected) {
      // Get assignment recommendation
      const candidates = await AssignmentService.suggestAssignment(
        companyId,
        tt.id,
        projectId
      );
      const topCandidate = candidates[0] ?? null;

      // Get schedule gap if we have a team member
      let gap: { startDate: Date; endDate: Date } | null = null;
      if (topCandidate) {
        gap = await AssignmentService.findScheduleGap(
          companyId,
          topCandidate.userId,
          1 // Default 1-day duration for initial suggestion
        );
      }

      // Build title: task type name, contextualized to project
      const title = tt.display;

      // Build reason string
      const reasonParts: string[] = [];
      if (tt.keywordScore > 0) {
        reasonParts.push("matches project description");
      }
      if (tt.historyScore > 0) {
        const projCount = projectsWithType.get(tt.id)?.size ?? 0;
        reasonParts.push(`used in ${projCount} similar project${projCount > 1 ? "s" : ""}`);
      }
      if (tt.isDefault) {
        reasonParts.push("company default");
      }

      // Confidence: map totalScore to a 0.3-0.9 range
      const confidence = Math.min(0.9, Math.max(0.3, tt.totalScore * 0.8 + 0.2));

      suggestions.push({
        taskTypeId: tt.id,
        taskTypeName: tt.display,
        title,
        notes: null,
        color: tt.color,
        teamMemberId: topCandidate?.userId ?? null,
        teamMemberName: topCandidate?.name ?? null,
        startDate: gap?.startDate.toISOString() ?? null,
        endDate: gap?.endDate.toISOString() ?? null,
        duration: 1,
        assignmentReason: topCandidate?.reason ?? null,
        confidence,
        reason: reasonParts.join("; ") || "suggested task type",
      });
    }

    return suggestions;
  },

  /**
   * Propose task creation actions to the approval queue.
   * Each suggested task becomes a separate pending action.
   * Deduplicates by checking for existing pending actions on the same project.
   */
  async proposeTaskCreation(
    companyId: string,
    userId: string,
    projectId: string,
    suggestions: TaskSuggestion[]
  ): Promise<{ proposed: number; deduplicated: number }> {
    const supabase = requireSupabase();
    let proposed = 0;
    let deduplicated = 0;

    // Fetch project name for context summary
    const { data: project } = await supabase
      .from("projects")
      .select("title")
      .eq("id", projectId)
      .single();

    const projectName = (project?.title as string) ?? "Unknown Project";

    for (const task of suggestions) {
      // Deduplicate: check if this exact task type was already proposed for this project
      const sourceId = `${projectId}:task:${task.taskTypeId}`;

      const actionData: CreateTaskActionData = {
        project_id: projectId,
        project_name: projectName,
        task_type_id: task.taskTypeId,
        task_type_name: task.taskTypeName,
        custom_title: task.title,
        task_notes: task.notes,
        task_color: task.color,
        suggested_team_member_id: task.teamMemberId,
        suggested_team_member_name: task.teamMemberName,
        suggested_start_date: task.startDate,
        suggested_end_date: task.endDate,
        suggested_duration: task.duration,
        assignment_reason: task.assignmentReason,
        company_id: companyId,
      };

      const actionId = await ApprovalQueueService.proposeAction({
        companyId,
        userId,
        actionType: "create_task",
        actionData: actionData as unknown as Record<string, unknown>,
        contextSummary: `Add "${task.title}" to project "${projectName}". ${task.reason}`,
        contextSource: "project_analysis",
        sourceId,
        confidence: task.confidence,
        priority: "normal",
      });

      if (actionId) {
        proposed++;
      } else {
        deduplicated++;
      }
    }

    return { proposed, deduplicated };
  },
};
