/**
 * useProjectActivity — workspace timeline reader.
 *
 * Reads `activities` for a single project, sorted newest first, then resolves
 * two side-channel joins that have no FK in the schema:
 *   - `created_by` → users.{first_name, last_name, user_color} (one query, distinct ids)
 *   - `attachment_ids[]` → project_photos.{url, thumbnail_url} (one query, flattened ids)
 *
 * The shape returned is what the workspace ACTIVITY tab consumes directly —
 * camelCased, with the user record collapsed to a `{ id, name, avatarColor }`
 * triple and attachments resolved to public URLs.
 */

import { useQuery } from "@tanstack/react-query";
import { requireSupabase } from "@/lib/supabase/helpers";
import { queryKeys } from "@/lib/api/query-client";

const ACTIVITY_TYPES = [
  "note",
  "email",
  "call",
  "meeting",
  "estimate_sent",
  "payment_received",
  "won",
  "lost",
  "system",
  "invoice_sent",
  "task_completed",
  "photo",
  "expense",
] as const;

export type ProjectActivityType = (typeof ACTIVITY_TYPES)[number];

export interface ProjectActivityCreator {
  id: string;
  name: string;
  avatarColor: string;
}

export interface ProjectActivityAttachment {
  id: string;
  url: string;
  thumbnailUrl: string | null;
}

export interface ProjectActivityEntry {
  id: string;
  type: ProjectActivityType;
  subject: string | null;
  content: string | null;
  createdAt: string;
  createdBy: ProjectActivityCreator | null;
  attachments: ProjectActivityAttachment[];
}

const FALLBACK_AVATAR_COLOR = "#6F94B0";

interface ActivityRow {
  id: string;
  type: string;
  subject: string | null;
  content: string | null;
  created_at: string;
  created_by: string | null;
  attachment_ids: string[] | null;
}

interface UserRow {
  id: string;
  first_name: string;
  last_name: string;
  user_color: string | null;
}

interface PhotoRow {
  id: string;
  url: string;
  thumbnail_url: string | null;
}

export function useProjectActivity(projectId: string | null, limit = 25) {
  return useQuery({
    queryKey: queryKeys.projectWorkspace.activity(projectId, limit),
    queryFn: async () => {
      if (!projectId) return [];
      const supabase = requireSupabase();

      const { data: rawActivities, error: activitiesError } = await supabase
        .from("activities")
        .select(
          "id, type, subject, content, created_at, created_by, attachment_ids"
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (activitiesError) throw activitiesError;
      const activities = (rawActivities ?? []) as ActivityRow[];

      const creatorIds = Array.from(
        new Set(
          activities
            .map((a) => a.created_by)
            .filter((id): id is string => !!id)
        )
      );
      const photoIds = Array.from(
        new Set(activities.flatMap((a) => a.attachment_ids ?? []))
      );

      const [creatorRows, photoRows] = await Promise.all([
        creatorIds.length === 0
          ? Promise.resolve<UserRow[]>([])
          : supabase
              .from("users")
              .select("id, first_name, last_name, user_color")
              .in("id", creatorIds)
              .then((r) => {
                if (r.error) throw r.error;
                return (r.data ?? []) as UserRow[];
              }),
        photoIds.length === 0
          ? Promise.resolve<PhotoRow[]>([])
          : supabase
              .from("project_photos")
              .select("id, url, thumbnail_url")
              .in("id", photoIds)
              .then((r) => {
                if (r.error) throw r.error;
                return (r.data ?? []) as PhotoRow[];
              }),
      ]);

      const creatorById = new Map(creatorRows.map((u) => [u.id, u]));
      const photoById = new Map(photoRows.map((p) => [p.id, p]));

      return activities.map<ProjectActivityEntry>((a) => {
        const creator = a.created_by ? creatorById.get(a.created_by) : null;
        const attachments = (a.attachment_ids ?? [])
          .map((id) => photoById.get(id))
          .filter((p): p is PhotoRow => !!p)
          .map<ProjectActivityAttachment>((p) => ({
            id: p.id,
            url: p.url,
            thumbnailUrl: p.thumbnail_url,
          }));

        return {
          id: a.id,
          type: a.type as ProjectActivityType,
          subject: a.subject,
          content: a.content,
          createdAt: a.created_at,
          createdBy: creator
            ? {
                id: creator.id,
                name: `${creator.first_name} ${creator.last_name}`.trim(),
                avatarColor: creator.user_color ?? FALLBACK_AVATAR_COLOR,
              }
            : null,
          attachments,
        };
      });
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });
}
