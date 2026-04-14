/**
 * OPS Web — Project Lifecycle Service
 *
 * Sprint P3: Automates project lifecycle management:
 *   - Stage change detection → follow-up task suggestions
 *   - Client status update email generation
 *   - Overdue task detection → reassignment suggestions
 *   - Completed project archival
 *
 * All actions flow through the approval queue — nothing is auto-executed.
 * Gated behind phase_c feature flag.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import { parseStringArray } from "@/lib/utils/parse";
import { ApprovalQueueService } from "./approval-queue-service";
import { AssignmentService } from "./assignment-service";
import { BusinessContextService } from "./business-context-service";
import { AIDraftService } from "./ai-draft-service";
import { AdminFeatureOverrideService } from "./admin-feature-override-service";
import { getCompanyLocale, renderServerString } from "@/i18n/server-render";
import type {
  SendStatusEmailActionData,
  ReassignTaskActionData,
  ArchiveProjectActionData,
  CreateTaskActionData,
} from "@/lib/types/approval-queue";

// ─── Stage Normalization ────────────────────────────────────────────────────

/**
 * Accept any legacy or display form of a project status and normalize to
 * the production lowercase canonical values:
 *   rfq, estimated, accepted, in_progress, completed, closed, archived.
 * See docs/reference §1d for verification against live data.
 */
function normalizeProjectStage(input: string): string {
  const slug = input.toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
  switch (slug) {
    case "rfq": return "rfq";
    case "estimated": return "estimated";
    case "accepted": return "accepted";
    case "in_progress": return "in_progress";
    case "completed": return "completed";
    case "closed": return "closed";
    case "archived": return "archived";
    default: return slug;
  }
}

// ─── Stage-to-Task Defaults ─────────────────────────────────────────────────

/**
 * Default follow-up tasks to seed when a project moves between stages.
 * Values are i18n keys into `server-emails` — resolved at propose time
 * using the company's locale so the task title the user sees is in the
 * right language.
 */
const DEFAULT_STAGE_TASK_KEYS: Record<string, string[]> = {
  "rfq→estimated": [
    "lifecycle.task.siteVisit",
    "lifecycle.task.prepareEstimate",
  ],
  "estimated→accepted": [
    "lifecycle.task.orderMaterials",
    "lifecycle.task.scheduleCrew",
    "lifecycle.task.sendConfirmationEmail",
  ],
  "accepted→in_progress": [
    "lifecycle.task.preJobWalkthrough",
    "lifecycle.task.dayOfSetup",
  ],
  "in_progress→completed": [
    "lifecycle.task.finalInspection",
    "lifecycle.task.sendCompletionEmail",
    "lifecycle.task.sendInvoice",
  ],
  "completed→closed": ["lifecycle.task.scheduleFollowUp"],
};

// ─── Lifecycle Configuration Defaults ───────────────────────────────────────

export interface LifecycleConfig {
  status_update_frequency_days: number;
  overdue_threshold_days: number;
  archive_after_days: number;
  stage_task_overrides: Record<string, string[]>;
}

const DEFAULT_CONFIG: LifecycleConfig = {
  status_update_frequency_days: 7,
  overdue_threshold_days: 1,
  archive_after_days: 30,
  stage_task_overrides: {},
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Get an admin user ID for attributing proposals.
 * Falls back to any active user in the company if no admins configured.
 */
async function getCompanyAdminUserId(companyId: string): Promise<string | null> {
  const supabase = requireSupabase();

  const { data: company } = await supabase
    .from("companies")
    .select("admin_ids")
    .eq("id", companyId)
    .single();

  const adminIds = ((company?.admin_ids as string) ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  if (adminIds.length > 0) return adminIds[0];

  // Fallback: find any active user with admin/owner role
  const { data: fallback } = await supabase
    .from("users")
    .select("id")
    .eq("company_id", companyId)
    .in("role", ["admin", "owner"])
    .eq("is_active", true)
    .is("deleted_at", null)
    .limit(1);

  return (fallback?.[0]?.id as string) ?? null;
}

function buildTransitionKey(oldStage: string, newStage: string): string {
  return `${oldStage.toLowerCase()}→${newStage.toLowerCase()}`;
}

async function getLifecycleConfig(
  companyId: string
): Promise<LifecycleConfig> {
  const supabase = requireSupabase();

  const { data } = await supabase
    .from("companies")
    .select("lifecycle_settings")
    .eq("id", companyId)
    .single();

  if (!data?.lifecycle_settings) return DEFAULT_CONFIG;

  const settings = data.lifecycle_settings as Record<string, unknown>;
  return {
    status_update_frequency_days:
      (settings.status_update_frequency_days as number) ??
      DEFAULT_CONFIG.status_update_frequency_days,
    overdue_threshold_days:
      (settings.overdue_threshold_days as number) ??
      DEFAULT_CONFIG.overdue_threshold_days,
    archive_after_days:
      (settings.archive_after_days as number) ??
      DEFAULT_CONFIG.archive_after_days,
    stage_task_overrides:
      (settings.stage_task_overrides as Record<string, string[]>) ??
      DEFAULT_CONFIG.stage_task_overrides,
  };
}

/**
 * Find the best-matching task types from the company's configured task types.
 * Prefer exact or substring matches over defaults.
 */
async function resolveTaskTypes(
  companyId: string,
  taskNames: string[]
): Promise<
  Array<{
    id: string;
    display: string;
    color: string;
    matched: boolean;
  }>
> {
  const supabase = requireSupabase();

  const { data: taskTypes } = await supabase
    .from("task_types")
    .select("id, display, color")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .limit(100);

  if (!taskTypes || taskTypes.length === 0) {
    // No task types configured — return generic entries without IDs
    return taskNames.map((name) => ({
      id: "",
      display: name,
      color: "#417394",
      matched: false,
    }));
  }

  const results: Array<{
    id: string;
    display: string;
    color: string;
    matched: boolean;
  }> = [];

  for (const name of taskNames) {
    const nameLower = name.toLowerCase();

    // Exact match first
    let match = taskTypes.find(
      (tt) => (tt.display as string).toLowerCase() === nameLower
    );

    // Substring match second
    if (!match) {
      match = taskTypes.find(
        (tt) =>
          (tt.display as string).toLowerCase().includes(nameLower) ||
          nameLower.includes((tt.display as string).toLowerCase())
      );
    }

    if (match) {
      results.push({
        id: match.id as string,
        display: match.display as string,
        color: (match.color as string) ?? "#417394",
        matched: true,
      });
    } else {
      results.push({
        id: "",
        display: name,
        color: "#417394",
        matched: false,
      });
    }
  }

  return results;
}

/**
 * Look at historical project transitions to find patterns.
 * For completed projects that went through the same status transition,
 * what tasks were typically created?
 */
async function getHistoricalTaskPatterns(
  companyId: string,
  newStage: string
): Promise<string[]> {
  const supabase = requireSupabase();

  // Find projects that have passed through this stage (now in a later stage).
  // Stage order (DB CHECK-constraint values, title case):
  //   RFQ → Estimated → Accepted → In Progress → Completed → Closed → Archived
  const STAGE_ORDER = ["rfq", "estimated", "accepted", "in_progress", "completed", "closed", "archived"];
  const normalizedInput = normalizeProjectStage(newStage);
  const stageIndex = STAGE_ORDER.indexOf(normalizedInput);
  const laterStages = stageIndex >= 0
    ? STAGE_ORDER.slice(stageIndex + 1)
    : [];

  // Include the current stage AND later stages (they all went through this stage)
  const relevantStages = [normalizedInput, ...laterStages].filter(Boolean);

  const { data: projects } = await supabase
    .from("projects")
    .select("id")
    .eq("company_id", companyId)
    .in("status", relevantStages)
    .is("deleted_at", null)
    .limit(20);

  if (!projects || projects.length === 0) return [];

  const projectIds = projects.map((p) => p.id as string);
  const { data: tasks } = await supabase
    .from("project_tasks")
    .select("task_type_id")
    .eq("company_id", companyId)
    .in("project_id", projectIds)
    .is("deleted_at", null)
    .limit(500);

  // Count task type frequency
  const freq = new Map<string, number>();
  for (const t of tasks ?? []) {
    const ttId = t.task_type_id as string;
    if (!ttId) continue;
    freq.set(ttId, (freq.get(ttId) ?? 0) + 1);
  }

  // Return task type IDs used in >50% of these projects
  const threshold = projectIds.length * 0.5;
  return Array.from(freq.entries())
    .filter(([, count]) => count >= threshold)
    .map(([id]) => id);
}

// ─── Service ────────────────────────────────────────────────────────────────

export const ProjectLifecycleService = {
  // ── P3.1 — Stage Change Detection & Follow-Up Task Creation ─────────

  /**
   * Called when a project's status changes. Suggests follow-up tasks
   * appropriate for the new stage via the approval queue.
   *
   * Task selection priority:
   * 1. Company-configured overrides (from lifecycle settings)
   * 2. Company's existing task types that match defaults
   * 3. Historical patterns from completed projects
   * 4. Generic defaults
   */
  async onProjectStageChange(
    companyId: string,
    projectId: string,
    oldStage: string,
    newStage: string
  ): Promise<void> {
    // Gate behind phase_c
    const enabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      companyId,
      "phase_c"
    );
    if (!enabled) return;

    const config = await getLifecycleConfig(companyId);
    const transitionKey = buildTransitionKey(oldStage, newStage);

    console.log(
      `[project-lifecycle] Stage change detected: ${transitionKey} for project ${projectId}`
    );

    // Determine which tasks to suggest. Overrides from company settings
    // are stored verbatim (user-chosen names). Defaults are i18n keys
    // that we resolve against the company's locale so the proposed task
    // titles show up in the right language when the user is browsing
    // the approval queue.
    const configuredTasks = config.stage_task_overrides[transitionKey];
    let taskNames: string[];

    if (configuredTasks && configuredTasks.length > 0) {
      taskNames = configuredTasks;
    } else {
      const defaultKeys = DEFAULT_STAGE_TASK_KEYS[transitionKey] ?? [];
      if (defaultKeys.length === 0) {
        console.log(
          `[project-lifecycle] No task mappings for transition ${transitionKey}`
        );
        return;
      }
      const locale = await getCompanyLocale(companyId);
      taskNames = await Promise.all(
        defaultKeys.map((key) =>
          renderServerString(locale, "server-emails", key)
        )
      );
    }

    if (taskNames.length === 0) {
      console.log(
        `[project-lifecycle] No task mappings for transition ${transitionKey}`
      );
      return;
    }

    // Resolve task names against company's task types
    const resolvedTypes = await resolveTaskTypes(companyId, taskNames);

    // Supplement with historical patterns
    const historicalTypeIds = await getHistoricalTaskPatterns(
      companyId,
      newStage
    );

    // Check existing tasks on this project to avoid duplicates
    const supabase = requireSupabase();
    const { data: existingTasks } = await supabase
      .from("project_tasks")
      .select("task_type_id, custom_title")
      .eq("project_id", projectId)
      .eq("company_id", companyId)
      .is("deleted_at", null);

    const existingTypeIds = new Set(
      (existingTasks ?? [])
        .map((t) => t.task_type_id as string)
        .filter(Boolean)
    );
    const existingTitles = new Set(
      (existingTasks ?? [])
        .map((t) => (t.custom_title as string)?.toLowerCase())
        .filter(Boolean)
    );

    // Fetch project name + find a userId to attribute the suggestion to
    const { data: project } = await supabase
      .from("projects")
      .select("title, company_id")
      .eq("id", projectId)
      .single();

    const projectName = (project?.title as string) ?? "Unknown Project";

    // Get an admin userId for the proposal
    const userId = await getCompanyAdminUserId(companyId);
    if (!userId) {
      console.log(`[project-lifecycle] No admin user found for company ${companyId}`);
      return;
    }

    // Propose each resolved task
    for (const resolved of resolvedTypes) {
      // Skip if already exists on project
      if (resolved.id && existingTypeIds.has(resolved.id)) continue;
      if (existingTitles.has(resolved.display.toLowerCase())) continue;

      // Get assignment recommendation
      let teamMemberId: string | null = null;
      let teamMemberName: string | null = null;
      let assignmentReason: string | null = null;
      let startDate: string | null = null;
      let endDate: string | null = null;

      if (resolved.id) {
        const candidates = await AssignmentService.suggestAssignment(
          companyId,
          resolved.id,
          projectId
        );
        const top = candidates[0];
        if (top) {
          teamMemberId = top.userId;
          teamMemberName = top.name;
          assignmentReason = top.reason;

          const gap = await AssignmentService.findScheduleGap(
            companyId,
            top.userId,
            1
          );
          startDate = gap.startDate.toISOString();
          endDate = gap.endDate.toISOString();
        }
      }

      const actionData: CreateTaskActionData = {
        project_id: projectId,
        project_name: projectName,
        task_type_id: resolved.id,
        task_type_name: resolved.display,
        custom_title: resolved.display,
        task_notes: null,
        task_color: resolved.color,
        suggested_team_member_id: teamMemberId,
        suggested_team_member_name: teamMemberName,
        suggested_start_date: startDate,
        suggested_end_date: endDate,
        suggested_duration: 1,
        assignment_reason: assignmentReason,
        company_id: companyId,
      };

      const sourceId = `${projectId}:stage:${transitionKey}:${resolved.display}`;

      await ApprovalQueueService.proposeAction({
        companyId,
        userId,
        actionType: "create_task",
        actionData: actionData as unknown as Record<string, unknown>,
        contextSummary: `Stage changed to "${newStage}" — add "${resolved.display}" to "${projectName}"`,
        contextSource: "stage_change",
        sourceId,
        confidence: resolved.matched ? 0.7 : 0.5,
        priority: "normal",
      });
    }

    // Also suggest tasks from historical patterns not already covered
    if (historicalTypeIds.length > 0) {
      const alreadySuggested = new Set(
        resolvedTypes.map((r) => r.id).filter(Boolean)
      );

      for (const ttId of historicalTypeIds) {
        if (alreadySuggested.has(ttId) || existingTypeIds.has(ttId)) continue;

        // Fetch task type info
        const { data: tt } = await supabase
          .from("task_types")
          .select("id, display, color")
          .eq("id", ttId)
          .single();

        if (!tt) continue;

        const candidates = await AssignmentService.suggestAssignment(
          companyId,
          ttId,
          projectId
        );
        const top = candidates[0];
        let gap: { startDate: Date; endDate: Date } | null = null;
        if (top) {
          gap = await AssignmentService.findScheduleGap(
            companyId,
            top.userId,
            1
          );
        }

        const actionData: CreateTaskActionData = {
          project_id: projectId,
          project_name: projectName,
          task_type_id: ttId,
          task_type_name: tt.display as string,
          custom_title: tt.display as string,
          task_notes: null,
          task_color: (tt.color as string) ?? "#417394",
          suggested_team_member_id: top?.userId ?? null,
          suggested_team_member_name: top?.name ?? null,
          suggested_start_date: gap?.startDate.toISOString() ?? null,
          suggested_end_date: gap?.endDate.toISOString() ?? null,
          suggested_duration: 1,
          assignment_reason: top?.reason ?? null,
          company_id: companyId,
        };

        await ApprovalQueueService.proposeAction({
          companyId,
          userId,
          actionType: "create_task",
          actionData: actionData as unknown as Record<string, unknown>,
          contextSummary: `Historical pattern: "${tt.display}" is commonly used at the "${newStage}" stage`,
          contextSource: "stage_change",
          sourceId: `${projectId}:stage:${transitionKey}:hist:${ttId}`,
          confidence: 0.5,
          priority: "low",
        });
      }
    }

    console.log(
      `[project-lifecycle] Proposed follow-up tasks for ${transitionKey} on ${projectId}`
    );

    // I1.5: When project reaches "completed", suggest an invoice
    if (newStage.toLowerCase() === "completed") {
      import("./invoice-suggestion-service")
        .then(({ InvoiceSuggestionService }) =>
          InvoiceSuggestionService.suggestInvoiceFromCompletion(
            companyId,
            userId,
            projectId
          )
        )
        .catch((err) =>
          console.error(
            "[project-lifecycle] Invoice suggestion on completion error:",
            err
          )
        );
    }
  },

  // ── P3.2 — Client Status Update Emails ─────────────────────────────

  /**
   * Generate a status update email draft for a project's client.
   * Uses AIDraftService for voice matching and BusinessContextService for data.
   */
  async generateStatusUpdate(
    companyId: string,
    projectId: string,
    userId: string
  ): Promise<void> {
    const supabase = requireSupabase();

    // Fetch project context
    const projectCtx = await BusinessContextService.getProjectContext(
      companyId,
      projectId
    );
    if (!projectCtx.found || !projectCtx.client) {
      console.log(
        `[project-lifecycle] Cannot generate status update: project ${projectId} not found or has no client`
      );
      return;
    }

    if (!projectCtx.client.email) {
      console.log(
        `[project-lifecycle] Cannot generate status update: client has no email`
      );
      return;
    }

    // Find the user's email connection for sending
    const { data: connections } = await supabase
      .from("email_connections")
      .select("id")
      .eq("company_id", companyId)
      .eq("status", "active")
      .eq("sync_enabled", true)
      .limit(1);

    const connectionId = (connections?.[0]?.id as string) ?? null;
    if (!connectionId) {
      console.log(
        `[project-lifecycle] No active email connection for company ${companyId}`
      );
      return;
    }

    // Determine what's changed since last status email
    const { data: lastStatusAction } = await supabase
      .from("agent_actions")
      .select("executed_at")
      .eq("company_id", companyId)
      .eq("action_type", "send_status_email")
      .in("status", ["executed"])
      .order("executed_at", { ascending: false })
      .limit(1);

    const lastStatusDate = lastStatusAction?.[0]?.executed_at
      ? new Date(lastStatusAction[0].executed_at as string)
      : null;

    // Count tasks completed since last update
    let tasksCompletedSinceLast = 0;
    let upcomingTaskCount = 0;

    if (projectCtx.tasks) {
      const activeTasks = projectCtx.tasks.filter(
        (t) => t.status !== "completed" && t.status !== "complete" && t.status !== "cancelled"
      );
      upcomingTaskCount = activeTasks.length;
    }

    // Query actual completion delta using updated_at as proxy for completion time
    if (lastStatusDate) {
      const { count } = await supabase
        .from("project_tasks")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("company_id", companyId)
        .eq("status", "completed")
        .gte("updated_at", lastStatusDate.toISOString())
        .is("deleted_at", null);
      tasksCompletedSinceLast = count ?? 0;
    } else {
      // First status email — count all completed tasks
      tasksCompletedSinceLast = projectCtx.tasks?.filter(
        (t) => t.status === "completed"
      ).length ?? 0;
    }

    // Generate draft using AI
    const locale = await getCompanyLocale(companyId);
    const subject = await renderServerString(
      locale,
      "server-emails",
      "statusEmail.subject",
      { projectTitle: projectCtx.title ?? "" }
    );
    const completionPct = projectCtx.metrics?.completionPercent ?? 0;

    // Build a manual draft context for the AI
    const statusSummary = [
      `Project: ${projectCtx.title}`,
      `Status: ${projectCtx.status}`,
      `Completion: ${completionPct}%`,
      tasksCompletedSinceLast > 0
        ? `Tasks completed since last update: ${tasksCompletedSinceLast}`
        : null,
      upcomingTaskCount > 0
        ? `Upcoming tasks: ${upcomingTaskCount}`
        : null,
      projectCtx.address ? `Location: ${projectCtx.address}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    // Fetch linked opportunity for profile type detection
    const { data: projectRow } = await supabase
      .from("projects")
      .select("opportunity_id")
      .eq("id", projectId)
      .single();
    const opportunityId = (projectRow?.opportunity_id as string) ?? undefined;

    // Use AIDraftService for voice-matched draft. profileTypeOverride
    // pins this draft to the "client_active_project" writing profile so
    // that recordDraftOutcome() at execution time feeds edits back into
    // the correct profile instead of resolving to "general".
    const draftResult = await AIDraftService.generateDraft({
      companyId,
      userId,
      connectionId,
      opportunityId,
      recipientEmail: projectCtx.client.email,
      recipientName: projectCtx.client.name ?? undefined,
      userInstruction: `Write a project status update email to the client. Here is the current project status:\n\n${statusSummary}\n\nProject summary: ${projectCtx.summary}\n\nKeep it professional, concise, and action-oriented. Include what's been completed and what's coming next.`,
      profileTypeOverride: "client_active_project",
    });

    let draftText: string;
    let draftHistoryId: string | null;

    if (draftResult.available && draftResult.draft) {
      draftText = draftResult.draft;
      draftHistoryId = draftResult.draftHistoryId || null;
    } else {
      // AI unavailable — fall back to a templated message rendered in
      // the company's locale. Insert a history row manually so edits to
      // the fallback also feed the writing profile at execution time.
      const progressParts: string[] = [];
      if (completionPct > 0) {
        progressParts.push(
          await renderServerString(
            locale,
            "server-emails",
            "statusEmail.progress.completion",
            { percent: completionPct }
          )
        );
      }
      if (tasksCompletedSinceLast > 0) {
        const completedKey =
          tasksCompletedSinceLast === 1
            ? "statusEmail.progress.tasksCompletedSingular"
            : "statusEmail.progress.tasksCompletedPlural";
        progressParts.push(
          await renderServerString(
            locale,
            "server-emails",
            completedKey,
            { count: tasksCompletedSinceLast }
          )
        );
      }
      if (upcomingTaskCount > 0) {
        const upcomingKey =
          upcomingTaskCount === 1
            ? "statusEmail.progress.upcomingSingular"
            : "statusEmail.progress.upcomingPlural";
        progressParts.push(
          await renderServerString(
            locale,
            "server-emails",
            upcomingKey,
            { count: upcomingTaskCount }
          )
        );
      }
      const progressLine = progressParts.join("");

      draftText = await renderServerString(
        locale,
        "server-emails",
        "statusEmail.fallback",
        {
          clientName: projectCtx.client.name ?? "",
          projectTitle: projectCtx.title ?? "",
          progressLine,
        }
      );

      const { data: fallbackHistory } = await supabase
        .from("ai_draft_history")
        .insert({
          company_id: companyId,
          user_id: userId,
          connection_id: connectionId,
          original_draft: draftText,
          profile_type: "client_active_project",
          status: "drafted",
        })
        .select("id")
        .single();
      draftHistoryId = (fallbackHistory?.id as string) ?? null;
    }

    const actionData: SendStatusEmailActionData = {
      project_id: projectId,
      project_title: projectCtx.title ?? "Unknown",
      client_id: projectCtx.client.id,
      client_name: projectCtx.client.name ?? "Unknown",
      client_email: projectCtx.client.email,
      subject,
      draft_text: draftText,
      connection_id: connectionId,
      completion_percent: completionPct,
      tasks_completed_since_last: tasksCompletedSinceLast,
      upcoming_tasks: upcomingTaskCount,
      draft_history_id: draftHistoryId,
    };

    await ApprovalQueueService.proposeAction({
      companyId,
      userId,
      actionType: "send_status_email",
      actionData: actionData as unknown as Record<string, unknown>,
      contextSummary: `Send status update to ${projectCtx.client.name} for "${projectCtx.title}" — ${completionPct}% complete`,
      contextSource: "project_lifecycle",
      sourceId: `${projectId}:status:${new Date().toISOString().split("T")[0]}`,
      confidence: 0.8,
      priority: "normal",
    });
  },

  /**
   * Find all active projects due for a status update and propose emails.
   * Called by the weekly cron job.
   */
  async scheduleStatusUpdates(companyId: string): Promise<number> {
    const supabase = requireSupabase();
    const config = await getLifecycleConfig(companyId);
    const frequencyDays = config.status_update_frequency_days;

    if (frequencyDays <= 0) return 0; // Disabled

    // Find active projects
    const { data: projects } = await supabase
      .from("projects")
      .select("id, title, client_id")
      .eq("company_id", companyId)
      .in("status", ["in_progress", "accepted"])
      .is("deleted_at", null)
      .not("client_id", "is", null)
      .limit(100);

    if (!projects || projects.length === 0) return 0;

    // Find which projects already had a recent status email proposed/sent
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - frequencyDays);

    const projectIds = projects.map((p) => p.id as string);
    const { data: recentActions } = await supabase
      .from("agent_actions")
      .select("source_id, status")
      .eq("company_id", companyId)
      .eq("action_type", "send_status_email")
      .in("status", ["pending", "executed", "approved"])
      .gte("created_at", cutoffDate.toISOString());

    const recentProjectIds = new Set(
      (recentActions ?? [])
        .map((a) => {
          const sourceId = a.source_id as string;
          return sourceId?.split(":status:")[0] ?? "";
        })
        .filter(Boolean)
    );

    // Get an admin userId
    const userId = await getCompanyAdminUserId(companyId);
    if (!userId) return 0;

    // Cap at 10 AI draft calls per cron run per company to avoid overloading
    const MAX_DRAFTS_PER_RUN = 10;
    let proposed = 0;
    for (const project of projects) {
      if (proposed >= MAX_DRAFTS_PER_RUN) break;

      const pid = project.id as string;
      if (recentProjectIds.has(pid)) continue;

      try {
        await ProjectLifecycleService.generateStatusUpdate(
          companyId,
          pid,
          userId
        );
        proposed++;
      } catch (err) {
        console.error(
          `[project-lifecycle] Failed to generate status update for ${pid}:`,
          err
        );
      }
    }

    return proposed;
  },

  // ── P3.3 — Overdue Task Detection & Reassignment ───────────────────

  /**
   * Find overdue tasks and propose reassignment.
   * A task is overdue if its calendar_event end_date has passed
   * and its status is not complete or cancelled.
   */
  async detectOverdueTasks(companyId: string): Promise<number> {
    const supabase = requireSupabase();
    const config = await getLifecycleConfig(companyId);

    if (config.overdue_threshold_days <= 0) return 0; // Disabled

    const now = new Date();

    // Find tasks with calendar events whose end_date has passed
    // Join project_tasks with calendar_events via calendar_event_id
    const { data: overdueTasks } = await supabase
      .from("project_tasks")
      .select(
        "id, custom_title, project_id, task_type_id, team_member_ids, status, calendar_event_id"
      )
      .eq("company_id", companyId)
      .not("status", "in", '("completed","cancelled","complete")')
      .not("calendar_event_id", "is", null)
      .is("deleted_at", null)
      .limit(200);

    if (!overdueTasks || overdueTasks.length === 0) return 0;

    // Fetch calendar events to check end dates
    const eventIds = overdueTasks
      .map((t) => t.calendar_event_id as string)
      .filter(Boolean);

    if (eventIds.length === 0) return 0;

    const { data: events } = await supabase
      .from("calendar_events")
      .select("id, end_date, start_date")
      .in("id", eventIds)
      .lt("end_date", now.toISOString());

    if (!events || events.length === 0) return 0;

    const overdueEventIds = new Set(events.map((e) => e.id as string));
    const eventMap = new Map(
      events.map((e) => [e.id as string, e])
    );

    // Check for existing pending reassign actions
    const taskIds = overdueTasks.map((t) => t.id as string);
    const { data: existingActions } = await supabase
      .from("agent_actions")
      .select("source_id")
      .eq("company_id", companyId)
      .eq("action_type", "reassign_task")
      .eq("status", "pending");

    const pendingReassignSourceIds = new Set(
      (existingActions ?? []).map((a) => a.source_id as string)
    );

    // Get admin userId
    const userId = await getCompanyAdminUserId(companyId);
    if (!userId) return 0;

    // Fetch project titles in batch
    const projectIds = [
      ...new Set(overdueTasks.map((t) => t.project_id as string).filter(Boolean)),
    ];
    const projectNameMap = new Map<string, string>();
    if (projectIds.length > 0) {
      const { data: projects } = await supabase
        .from("projects")
        .select("id, title")
        .in("id", projectIds);
      for (const p of projects ?? []) {
        projectNameMap.set(p.id as string, p.title as string);
      }
    }

    // Fetch team member names
    const allMemberIds = new Set<string>();
    for (const t of overdueTasks) {
      for (const id of parseStringArray(t.team_member_ids)) {
        allMemberIds.add(id);
      }
    }
    const memberNameMap = new Map<string, string>();
    if (allMemberIds.size > 0) {
      const { data: members } = await supabase
        .from("users")
        .select("id, first_name, last_name")
        .in("id", Array.from(allMemberIds));
      for (const m of members ?? []) {
        const name =
          `${(m.first_name as string) ?? ""} ${(m.last_name as string) ?? ""}`.trim() ||
          "Unknown";
        memberNameMap.set(m.id as string, name);
      }
    }

    let proposed = 0;

    for (const task of overdueTasks) {
      const eventId = task.calendar_event_id as string;
      if (!overdueEventIds.has(eventId)) continue;

      const taskId = task.id as string;
      const sourceId = `${taskId}:reassign`;
      if (pendingReassignSourceIds.has(sourceId)) continue;

      const event = eventMap.get(eventId);
      const endDate = event?.end_date
        ? new Date(event.end_date as string)
        : now;
      const daysOverdue = Math.max(
        1,
        Math.floor((now.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24))
      );

      // Skip if below threshold
      if (daysOverdue < config.overdue_threshold_days) continue;

      const currentMemberIds = parseStringArray(task.team_member_ids);
      const currentMemberId = currentMemberIds[0] ?? null;
      const currentMemberName = currentMemberId
        ? memberNameMap.get(currentMemberId) ?? null
        : null;
      const projectId = task.project_id as string;
      const projectTitle = projectNameMap.get(projectId) ?? "Unknown Project";
      const taskTitle =
        (task.custom_title as string) ?? "Untitled Task";

      // Suggest reassignment
      const taskTypeId = (task.task_type_id as string) ?? "";
      const candidates = await AssignmentService.suggestAssignment(
        companyId,
        taskTypeId,
        projectId
      );

      // Find a candidate different from the current assignee
      const newCandidate =
        candidates.find((c) => c.userId !== currentMemberId) ??
        candidates[0] ??
        null;

      if (!newCandidate) {
        // No reassignment candidate — still notify admin about the overdue task
        try {
          const { NotificationService } = await import("./notification-service");
          await NotificationService.create({
            userId,
            companyId,
            type: "mention",
            title: "Overdue task — no available team",
            body: `"${taskTitle}" on "${projectTitle}" is ${daysOverdue} day${daysOverdue > 1 ? "s" : ""} overdue. No team members available for reassignment.`,
            persistent: false,
            actionUrl: `/projects/${projectId}`,
            actionLabel: "View Project",
          });
        } catch {
          // Non-critical
        }
        continue;
      }

      // Find schedule gap for the new assignee
      const gap = await AssignmentService.findScheduleGap(
        companyId,
        newCandidate.userId,
        1
      );

      const actionData: ReassignTaskActionData = {
        task_id: taskId,
        task_title: taskTitle,
        project_id: projectId,
        project_title: projectTitle,
        current_team_member_id: currentMemberId,
        current_team_member_name: currentMemberName,
        suggested_team_member_id: newCandidate.userId,
        suggested_team_member_name: newCandidate.name,
        new_start_date: gap.startDate.toISOString(),
        new_end_date: gap.endDate.toISOString(),
        overdue_days: daysOverdue,
        assignment_reason: newCandidate.reason,
      };

      await ApprovalQueueService.proposeAction({
        companyId,
        userId,
        actionType: "reassign_task",
        actionData: actionData as unknown as Record<string, unknown>,
        contextSummary: `"${taskTitle}" is ${daysOverdue} day${daysOverdue > 1 ? "s" : ""} overdue. Suggest reassigning to ${newCandidate.name}.`,
        contextSource: "overdue_detection",
        sourceId,
        confidence: 0.6,
        priority: daysOverdue > 7 ? "high" : "normal",
      });

      proposed++;
    }

    return proposed;
  },

  // ── P3.4 — Project Archival ────────────────────────────────────────

  /**
   * Find completed projects that are candidates for archival.
   * Criteria: status = completed, all tasks done, 30+ days since last activity.
   */
  async detectArchivableProjects(companyId: string): Promise<number> {
    const supabase = requireSupabase();
    const config = await getLifecycleConfig(companyId);
    const archiveDays = config.archive_after_days;

    if (archiveDays <= 0) return 0; // Disabled

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - archiveDays);

    // Find completed (not already archived) projects
    const { data: completedProjects } = await supabase
      .from("projects")
      .select("id, title, client_id")
      .eq("company_id", companyId)
      .eq("status", "completed")
      .is("deleted_at", null)
      .limit(100);

    if (!completedProjects || completedProjects.length === 0) return 0;

    // Check for existing pending archive actions
    const { data: existingActions } = await supabase
      .from("agent_actions")
      .select("source_id")
      .eq("company_id", companyId)
      .eq("action_type", "archive_project")
      .eq("status", "pending");

    const pendingArchiveSourceIds = new Set(
      (existingActions ?? []).map((a) => a.source_id as string)
    );

    // Get admin userId
    const userId = await getCompanyAdminUserId(companyId);
    if (!userId) return 0;

    let proposed = 0;

    for (const project of completedProjects) {
      const projectId = project.id as string;
      const sourceId = `${projectId}:archive`;

      if (pendingArchiveSourceIds.has(sourceId)) continue;

      // Check all tasks are complete or cancelled
      const { data: incompleteTasks } = await supabase
        .from("project_tasks")
        .select("id")
        .eq("project_id", projectId)
        .eq("company_id", companyId)
        .not("status", "in", '("completed","cancelled","complete")')
        .is("deleted_at", null)
        .limit(1);

      if (incompleteTasks && incompleteTasks.length > 0) continue;

      // Get all tasks for counts
      const { data: allTasks } = await supabase
        .from("project_tasks")
        .select("id, status")
        .eq("project_id", projectId)
        .eq("company_id", companyId)
        .is("deleted_at", null);

      const totalTasks = allTasks?.length ?? 0;
      const completedTasks = (allTasks ?? []).filter(
        (t) => t.status === "completed"
      ).length;

      // Check last activity — use the most recent task or calendar event update
      const { data: recentActivity } = await supabase
        .from("project_tasks")
        .select("updated_at")
        .eq("project_id", projectId)
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(1);

      const lastActivityDate = recentActivity?.[0]?.updated_at
        ? new Date(recentActivity[0].updated_at as string)
        : null;

      if (lastActivityDate && lastActivityDate > cutoffDate) continue;

      // Check financials
      const projectCtx = await BusinessContextService.getProjectContext(
        companyId,
        projectId
      );
      const outstandingBalance = projectCtx.financials?.outstandingBalance ?? 0;
      if (outstandingBalance > 0) continue; // Don't archive with outstanding invoices

      const completedDate = lastActivityDate?.toISOString() ?? null;
      const daysAgo = lastActivityDate
        ? Math.floor(
            (Date.now() - lastActivityDate.getTime()) / (1000 * 60 * 60 * 24)
          )
        : archiveDays;

      const actionData: ArchiveProjectActionData = {
        project_id: projectId,
        project_title: (project.title as string) ?? "Unknown",
        completed_date: completedDate,
        days_since_completion: daysAgo,
        total_tasks: totalTasks,
        completed_tasks: completedTasks,
        total_invoiced: projectCtx.financials?.invoicedTotal ?? 0,
        outstanding_balance: outstandingBalance,
      };

      await ApprovalQueueService.proposeAction({
        companyId,
        userId,
        actionType: "archive_project",
        actionData: actionData as unknown as Record<string, unknown>,
        contextSummary: `Archive "${project.title}" — completed ${daysAgo} days ago, all tasks done, fully invoiced.`,
        contextSource: "lifecycle_automation",
        sourceId,
        confidence: 0.9,
        priority: "low",
      });

      proposed++;
    }

    return proposed;
  },
};
