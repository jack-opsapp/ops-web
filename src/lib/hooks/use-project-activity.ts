/**
 * useProjectActivity — workspace timeline reader.
 *
 * project_notes is the iOS-canonical timeline source. event_kind discriminates
 * user-authored notes (NULL → kind='note') from system events written by web
 * (status_change, payment_received, project_archived, etc.). content_metadata
 * carries each event's structured payload (the {from,to} of a status change,
 * the {paymentId,amount,method} of a payment, etc.).
 *
 * iOS-additive contract: event_kind and content_metadata are nullable
 * additions on project_notes (migration 20260507130000). iOS treats rows
 * with event_kind set as plain notes until the next App Store release.
 *
 * Read shape: select project_notes ordered desc, then a single follow-up
 * users query to hydrate author info (author_id has no FK).
 */

import { useQuery } from "@tanstack/react-query";
import { requireSupabase } from "@/lib/supabase/helpers";
import { queryKeys } from "@/lib/api/query-client";
import type { NoteAttachment } from "@/lib/types/pipeline";

export type ProjectActivityKind =
  | "note"
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

export interface ProjectActivityAuthor {
  id: string;
  name: string;
  avatarColor: string;
}

export interface ProjectActivityEntry {
  id: string;
  kind: ProjectActivityKind;
  content: string;
  createdAt: string;
  author: ProjectActivityAuthor | null;
  attachments: NoteAttachment[];
  mentionedUserIds: string[];
  /** Structured payload for system events. NULL for user notes.
   *  Examples: status_change → { from, to }; payment_received → { paymentId, amount, method }. */
  eventPayload: Record<string, unknown> | null;
}

const FALLBACK_AVATAR_COLOR = "#6F94B0";

interface NoteRow {
  id: string;
  content: string | null;
  content_metadata: Record<string, unknown> | null;
  event_kind: string | null;
  created_at: string;
  attachments: NoteAttachment[] | null;
  mentioned_user_ids: string[] | null;
  author_id: string | null;
}

interface UserRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  user_color: string | null;
}

export function useProjectActivity(projectId: string | null, limit = 25) {
  return useQuery({
    queryKey: queryKeys.projectWorkspace.activity(projectId, limit),
    queryFn: async (): Promise<ProjectActivityEntry[]> => {
      if (!projectId) return [];
      const supabase = requireSupabase();

      const { data: rawNotes, error: notesError } = await supabase
        .from("project_notes")
        .select(
          "id, content, content_metadata, event_kind, created_at, attachments, mentioned_user_ids, author_id",
        )
        .eq("project_id", projectId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (notesError) throw notesError;
      const notes = (rawNotes ?? []) as NoteRow[];

      const authorIds = Array.from(
        new Set(notes.map((n) => n.author_id).filter((id): id is string => !!id)),
      );

      const authorRows: UserRow[] =
        authorIds.length === 0
          ? []
          : await supabase
              .from("users")
              .select("id, first_name, last_name, user_color")
              .in("id", authorIds)
              .then((r) => {
                if (r.error) throw r.error;
                return (r.data ?? []) as UserRow[];
              });

      const authorById = new Map(authorRows.map((u) => [u.id, u]));

      return notes.map<ProjectActivityEntry>((n) => {
        const author = n.author_id ? authorById.get(n.author_id) ?? null : null;
        return {
          id: n.id,
          kind: (n.event_kind as ProjectActivityKind | null) ?? "note",
          content: n.content ?? "",
          createdAt: n.created_at,
          author: author
            ? {
                id: author.id,
                name:
                  `${author.first_name ?? ""} ${author.last_name ?? ""}`.trim() || "Unknown",
                avatarColor: author.user_color ?? FALLBACK_AVATAR_COLOR,
              }
            : null,
          attachments: n.attachments ?? [],
          mentionedUserIds: n.mentioned_user_ids ?? [],
          eventPayload: n.content_metadata ?? null,
        };
      });
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });
}
