/**
 * OPS Web - Project Preview Service
 *
 * Lightweight fetcher for the calendar event hover popover. Pulls the most
 * recent N photos and notes for a project so the operator gets a glanceable
 * preview without opening the project.
 */

import { requireSupabase, parseDate } from "@/lib/supabase/helpers";

export interface ProjectPreviewPhoto {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  takenAt: Date | null;
  caption: string | null;
}

export interface ProjectPreviewNote {
  id: string;
  content: string;
  authorId: string;
  createdAt: Date | null;
}

export interface ProjectPreview {
  photos: ProjectPreviewPhoto[];
  notes: ProjectPreviewNote[];
}

const DEFAULT_PHOTO_LIMIT = 4;
const DEFAULT_NOTE_LIMIT = 3;

export const ProjectPreviewService = {
  async fetch(
    projectId: string,
    options: { photoLimit?: number; noteLimit?: number } = {}
  ): Promise<ProjectPreview> {
    const supabase = requireSupabase();
    const photoLimit = options.photoLimit ?? DEFAULT_PHOTO_LIMIT;
    const noteLimit = options.noteLimit ?? DEFAULT_NOTE_LIMIT;

    const [photosRes, notesRes] = await Promise.all([
      supabase
        .from("project_photos")
        .select("id, url, thumbnail_url, taken_at, caption, created_at")
        .eq("project_id", projectId)
        .is("deleted_at", null)
        .order("taken_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(photoLimit),
      supabase
        .from("project_notes")
        .select("id, content, author_id, created_at")
        .eq("project_id", projectId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(noteLimit),
    ]);

    if (photosRes.error) {
      throw new Error(`Failed to fetch project photos: ${photosRes.error.message}`);
    }
    if (notesRes.error) {
      throw new Error(`Failed to fetch project notes: ${notesRes.error.message}`);
    }

    const photos: ProjectPreviewPhoto[] = (photosRes.data ?? []).map((row) => ({
      id: row.id as string,
      url: row.url as string,
      thumbnailUrl: (row.thumbnail_url as string) ?? null,
      takenAt: parseDate(row.taken_at),
      caption: (row.caption as string) ?? null,
    }));

    const notes: ProjectPreviewNote[] = (notesRes.data ?? []).map((row) => ({
      id: row.id as string,
      content: row.content as string,
      authorId: row.author_id as string,
      createdAt: parseDate(row.created_at),
    }));

    return { photos, notes };
  },
};
