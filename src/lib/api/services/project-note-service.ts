/**
 * OPS Web - Project Note Service
 *
 * CRUD for project-level notes stored in Supabase `project_notes` table.
 * Follows the same pattern as activity-comment-service.ts.
 */

import { requireSupabase, parseDate, parseDateRequired } from "@/lib/supabase/helpers";
import type {
  ProjectNote,
  CreateProjectNote,
  UpdateProjectNote,
  NoteAttachment,
} from "@/lib/types/pipeline";

// ─── Database ↔ TypeScript Mapping ────────────────────────────────────────────

type ProjectNoteRow = {
  id: string;
  project_id: string;
  company_id: string;
  author_id: string;
  content: string;
  attachments: NoteAttachment[] | null;
  mentioned_user_ids: string[] | null;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
  /** Web-side timeline discriminator. NULL = user-authored note. */
  event_kind?: string | null;
  /** Structured event payload for system events. NULL for user notes. */
  content_metadata?: Record<string, unknown> | null;
};

/**
 * System events that web writes to project_notes alongside user-authored
 * notes. The discriminator lives in the `event_kind` column (added in
 * migration 20260507130000) and is iOS-additive — iOS treats these as
 * plain notes until the next App Store release.
 */
export type ProjectSystemEventKind =
  | "status_change"
  | "estimate_sent"
  | "estimate_approved"
  | "estimate_declined"
  | "invoice_sent"
  | "payment_received"
  | "expense_logged"
  | "photo_uploaded"
  | "project_created"
  | "project_archived"
  | "task_completed";

export interface CreateProjectSystemEvent {
  projectId: string;
  companyId: string;
  authorId: string;
  eventKind: ProjectSystemEventKind;
  content: string;
  contentMetadata?: Record<string, unknown> | null;
  attachments?: NoteAttachment[];
  /** Immutable mutation time for a durable status-lifecycle projection. */
  lifecycleOccurredAt?: string;
}

export function mapRowToProjectNote(row: ProjectNoteRow): ProjectNote {
  return {
    id: row.id,
    projectId: row.project_id,
    companyId: row.company_id,
    authorId: row.author_id,
    content: row.content,
    attachments: row.attachments ?? [],
    mentionedUserIds: row.mentioned_user_ids ?? [],
    createdAt: parseDateRequired(row.created_at),
    updatedAt: parseDate(row.updated_at),
    deletedAt: parseDate(row.deleted_at),
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const ProjectNoteService = {
  async fetchNotes(
    projectId: string,
    companyId: string
  ): Promise<ProjectNote[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("project_notes")
      .select("*")
      .eq("project_id", projectId)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Failed to fetch notes: ${error.message}`);
    return (data ?? []).map(mapRowToProjectNote);
  },

  async createNote(input: CreateProjectNote): Promise<ProjectNote> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("project_notes")
      .insert({
        project_id: input.projectId,
        company_id: input.companyId,
        author_id: input.authorId,
        content: input.content,
        attachments: input.attachments ?? [],
        mentioned_user_ids: input.mentionedUserIds ?? [],
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create note: ${error.message}`);
    return mapRowToProjectNote(data);
  },

  /**
   * Insert a system-event row on the unified timeline. Same table as user
   * notes (iOS-canonical) — the `event_kind` column tags it for web-side
   * rendering. Use for project_created, project_archived, status_change,
   * payment_received, etc. — anything the workspace timeline needs to
   * display as a system event.
   */
  async createSystemEvent(input: CreateProjectSystemEvent): Promise<ProjectNote> {
    const supabase = requireSupabase();
    const lifecycleCreatedAt =
      input.eventKind === "status_change" &&
      typeof input.contentMetadata?.lifecycle_event_id === "string" &&
      input.lifecycleOccurredAt
        ? input.lifecycleOccurredAt
        : undefined;
    const { data, error } = await supabase
      .from("project_notes")
      .insert({
        project_id: input.projectId,
        company_id: input.companyId,
        author_id: input.authorId,
        content: input.content,
        attachments: input.attachments ?? [],
        mentioned_user_ids: [],
        event_kind: input.eventKind,
        content_metadata: input.contentMetadata ?? null,
        ...(lifecycleCreatedAt ? { created_at: lifecycleCreatedAt } : {}),
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create system event: ${error.message}`);
    return mapRowToProjectNote(data);
  },

  async updateNote(input: UpdateProjectNote): Promise<ProjectNote> {
    const supabase = requireSupabase();
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (input.content !== undefined) updates.content = input.content;
    if (input.attachments !== undefined) updates.attachments = input.attachments;
    if (input.mentionedUserIds !== undefined)
      updates.mentioned_user_ids = input.mentionedUserIds;

    const { data, error } = await supabase
      .from("project_notes")
      .update(updates)
      .eq("id", input.id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update note: ${error.message}`);
    return mapRowToProjectNote(data);
  },

  async deleteNote(id: string): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("project_notes")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw new Error(`Failed to delete note: ${error.message}`);
  },

  async fetchNotesForMentionedUser(
    userId: string,
    companyId: string
  ): Promise<ProjectNote[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("project_notes")
      .select("*")
      .eq("company_id", companyId)
      .contains("mentioned_user_ids", [userId])
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Failed to fetch mentioned notes: ${error.message}`);
    return (data ?? []).map(mapRowToProjectNote);
  },

  async migrateFromLegacy(
    projectId: string,
    companyId: string,
    legacyNotes: string,
    authorId: string
  ): Promise<ProjectNote | null> {
    if (!legacyNotes || !legacyNotes.trim()) return null;

    // Check if already migrated (any note exists for this project)
    const supabase = requireSupabase();
    const { data: existing } = await supabase
      .from("project_notes")
      .select("id")
      .eq("project_id", projectId)
      .limit(1);

    if (existing && existing.length > 0) return null;

    return ProjectNoteService.createNote({
      projectId,
      companyId,
      authorId,
      content: legacyNotes.trim(),
    });
  },
};
