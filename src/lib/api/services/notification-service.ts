import { requireSupabase } from "@/lib/supabase/helpers";

export type NotificationType =
  | "mention"
  | "role_needed"
  | "pipeline_complete"
  | "gmail_sync"
  | "email_sync_complete"
  | "intel_available"
  | "setup_prompt"
  | "leads_waiting"
  | "system"
  | "project_assigned"
  | "task_assigned"
  | "task_completed"
  | "schedule_change"
  | "expense_submitted"
  | "expense_approved"
  | "duplicates_found"
  | "ai_milestone"
  | "agent_suggestion"
  | "trial_expiry"
  | "payment_review_stack"
  | "task_review_stack"
  | "unscheduled_review_stack"
  | "projects_needing_tasks";

export interface AppNotification {
  id: string;
  userId: string;
  companyId: string;
  type: NotificationType;
  title: string;
  body: string;
  projectId: string | null;
  noteId: string | null;
  isRead: boolean;
  persistent: boolean;
  actionUrl: string | null;
  actionLabel: string | null;
  createdAt: Date;
}

function mapRow(row: Record<string, unknown>): AppNotification {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    companyId: row.company_id as string,
    type: row.type as NotificationType,
    title: row.title as string,
    body: row.body as string,
    projectId: row.project_id as string | null,
    noteId: row.note_id as string | null,
    isRead: row.is_read as boolean,
    persistent: (row.persistent as boolean) ?? false,
    actionUrl: row.action_url as string | null,
    actionLabel: row.action_label as string | null,
    createdAt: new Date(row.created_at as string),
  };
}

export interface CreateNotificationParams {
  userId: string;
  companyId: string;
  type: NotificationType;
  title: string;
  body: string;
  persistent?: boolean;
  actionUrl?: string;
  actionLabel?: string;
  projectId?: string;
}

export const NotificationService = {
  /**
   * General-purpose notification creation. Use this for all new notification types.
   * Deduplication is enforced at the DB level by a partial unique index on
   * (user_id, company_id, type, title) WHERE is_read = false.
   * Uses an RPC (INSERT ... ON CONFLICT DO NOTHING) so duplicates are silently
   * ignored server-side — no 409 in the console, no client-side error handling.
   */
  async create(params: CreateNotificationParams): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase.rpc("create_notification_if_new", {
      p_user_id: params.userId,
      p_company_id: params.companyId,
      p_type: params.type,
      p_title: params.title,
      p_body: params.body,
      p_persistent: params.persistent ?? false,
      p_action_url: params.actionUrl ?? null,
      p_action_label: params.actionLabel ?? null,
      p_project_id: params.projectId ?? null,
    });

    if (error) {
      console.error("[NotificationService.create] Failed:", error.message);
    }
  },

  async createMentionNotifications(params: {
    mentionedUserIds: string[];
    authorName: string;
    projectId: string;
    projectTitle: string;
    noteId: string;
    companyId: string;
  }): Promise<void> {
    if (params.mentionedUserIds.length === 0) return;

    const supabase = requireSupabase();
    const rows = params.mentionedUserIds.map((userId) => ({
      user_id: userId,
      company_id: params.companyId,
      type: "mention" as const,
      title: `${params.authorName} mentioned you`,
      body: `You were mentioned in a note on ${params.projectTitle}`,
      project_id: params.projectId,
      note_id: params.noteId,
      is_read: false,
    }));

    const { error } = await supabase.from("notifications").insert(rows);
    if (error) {
      console.error("Failed to create mention notifications:", error);
    }
  },

  async fetchUnread(
    userId: string,
    companyId: string
  ): Promise<AppNotification[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .eq("company_id", companyId)
      .eq("is_read", false)
      .order("created_at", { ascending: true })
      .limit(50);

    if (error) throw error;
    return (data ?? []).map(mapRow);
  },

  async markAsRead(notificationId: string): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", notificationId);
    if (error) throw error;
  },

  async markAllAsRead(userId: string, companyId: string): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("company_id", companyId)
      .eq("is_read", false);
    if (error) throw error;
  },

  async dismissAllDismissible(userId: string, companyId: string): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("company_id", companyId)
      .eq("is_read", false)
      .eq("persistent", false);
    if (error) throw error;
  },
};
