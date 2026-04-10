/**
 * OPS Web — Approval Queue Types
 *
 * Types for agent-proposed actions that require user approval.
 */

// ─── Action Types ─────────────────────────────────────────────────────────────

export type AgentActionType =
  | "create_project"
  | "create_task"
  | "create_invoice"
  | "send_email"
  | "send_status_email"
  | "reassign_task"
  | "archive_project";

export type AgentActionStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executed"
  | "failed"
  | "expired"
  | "cancelled";

export type AgentActionPriority = "low" | "normal" | "high" | "urgent";

export type AgentActionContextSource =
  | "email_thread"
  | "schedule_gap"
  | "overdue_task"
  | "invoice_due"
  | "project_analysis"
  | "manual"
  | "project_lifecycle"
  | "overdue_detection"
  | "lifecycle_automation"
  | "stage_change";

// ─── Create Project Payload ───────────────────────────────────────────────────

export interface CreateProjectActionData {
  title: string;
  client_id: string | null;
  address: string | null;
  scope: string | null;
  suggested_tasks: Array<{
    task_type_id?: string;
    title: string;
  }>;
  source_thread_id: string | null;
  source_opportunity_id: string | null;
}

// ─── Create Task Payload ─────────────────────────────────────────────────────

export interface CreateTaskActionData {
  project_id: string;
  project_name: string;
  task_type_id: string;
  task_type_name: string;
  custom_title: string;
  task_notes: string | null;
  task_color: string | null;
  suggested_team_member_id: string | null;
  suggested_team_member_name: string | null;
  suggested_start_date: string | null;
  suggested_end_date: string | null;
  suggested_duration: number | null;
  assignment_reason: string | null;
  company_id: string;
}

// ─── Send Status Email Payload ───────────────────────────────────────────

export interface SendStatusEmailActionData {
  project_id: string;
  project_title: string;
  client_id: string;
  client_name: string;
  client_email: string;
  subject: string;
  draft_text: string;
  connection_id: string;
  completion_percent: number;
  tasks_completed_since_last: number;
  upcoming_tasks: number;
}

// ─── Reassign Task Payload ──────────────────────────────────────────────

export interface ReassignTaskActionData {
  task_id: string;
  task_title: string;
  project_id: string;
  project_title: string;
  current_team_member_id: string | null;
  current_team_member_name: string | null;
  suggested_team_member_id: string;
  suggested_team_member_name: string;
  new_start_date: string;
  new_end_date: string;
  overdue_days: number;
  assignment_reason: string;
}

// ─── Archive Project Payload ────────────────────────────────────────────

export interface ArchiveProjectActionData {
  project_id: string;
  project_title: string;
  completed_date: string | null;
  days_since_completion: number;
  total_tasks: number;
  completed_tasks: number;
  total_invoiced: number;
  outstanding_balance: number;
}

// ─── Agent Action ─────────────────────────────────────────────────────────────

export interface AgentAction {
  id: string;
  companyId: string;
  userId: string;
  actionType: AgentActionType;
  actionData: Record<string, unknown>;
  contextSummary: string;
  contextSource: AgentActionContextSource | null;
  sourceId: string | null;
  confidence: number;
  priority: AgentActionPriority;
  status: AgentActionStatus;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNotes: string | null;
  executedAt: Date | null;
  executionResult: Record<string, unknown> | null;
  error: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Service Params ───────────────────────────────────────────────────────────

export interface ProposeActionParams {
  companyId: string;
  userId: string;
  actionType: AgentActionType;
  actionData: Record<string, unknown>;
  contextSummary: string;
  contextSource?: AgentActionContextSource;
  sourceId?: string;
  confidence?: number;
  priority?: AgentActionPriority;
  expiresAt?: Date;
}

export interface QueueFilters {
  status?: AgentActionStatus;
  actionType?: AgentActionType;
  priority?: AgentActionPriority;
}

export interface QueueStats {
  pending: number;
  approvedToday: number;
  rejectedToday: number;
  avgResponseTimeMinutes: number | null;
}
