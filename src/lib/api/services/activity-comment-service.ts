/**
 * OPS Web - Activity Comment Service
 *
 * Threaded comments attached to Activity entries in the opportunity timeline.
 */

import { requireSupabase, parseDate, parseDateRequired } from "@/lib/supabase/helpers";
import type {
  ActivityComment,
  CreateActivityComment,
} from "@/lib/types/pipeline";

// ─── Database ↔ TypeScript Mapping ────────────────────────────────────────────

function mapFromDb(row: Record<string, unknown>): ActivityComment {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    activityId: row.activity_id as string,
    userId: row.user_id as string,
    content: row.content as string,
    isClientVisible: (row.is_client_visible as boolean) ?? false,
    createdAt: parseDateRequired(row.created_at),
    updatedAt: parseDate(row.updated_at),
    deletedAt: parseDate(row.deleted_at),
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const ActivityCommentService = {
  async fetchComments(activityId: string): Promise<ActivityComment[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("activity_comments")
      .select("*")
      .eq("activity_id", activityId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });

    if (error) throw new Error(`Failed to fetch comments: ${error.message}`);
    return (data ?? []).map(mapFromDb);
  },

  async createComment(data: CreateActivityComment): Promise<ActivityComment> {
    const supabase = requireSupabase();

    const { data: created, error } = await supabase
      .from("activity_comments")
      .insert({
        company_id: data.companyId,
        activity_id: data.activityId,
        user_id: data.userId,
        content: data.content,
        is_client_visible: data.isClientVisible ?? false,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create comment: ${error.message}`);
    return mapFromDb(created);
  },

  async updateComment(id: string, content: string): Promise<ActivityComment> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("activity_comments")
      .update({ content, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update comment: ${error.message}`);
    return mapFromDb(data);
  },

  async deleteComment(id: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("activity_comments")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw new Error(`Failed to delete comment: ${error.message}`);
  },
};
