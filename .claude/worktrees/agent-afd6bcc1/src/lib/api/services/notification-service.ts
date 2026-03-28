import { requireSupabase } from "@/lib/supabase/helpers";

export interface AppNotification {
  id: string;
  userId: string;
  companyId: string;
  type: "mention" | "role_needed";
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
    type: row.type as "mention" | "role_needed",
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

export const NotificationService = {
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
