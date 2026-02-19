import { describe, it, expect, vi } from "vitest";

// Mock Supabase helpers to avoid Firebase initialization
vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: vi.fn(),
  parseDate: (v: unknown) => (v ? new Date(v as string) : null),
  parseDateRequired: (v: unknown) => (v ? new Date(v as string) : new Date()),
}));

import { mapRowToProjectNote } from "../project-note-service";

describe("ProjectNoteService", () => {
  describe("mapRowToProjectNote", () => {
    it("maps a Supabase row to ProjectNote", () => {
      const row = {
        id: "uuid-1",
        project_id: "proj-1",
        company_id: "comp-1",
        author_id: "user-1",
        content: "Hello @[John](user-2)",
        attachments: [
          { url: "https://s3/photo.jpg", caption: "Site photo", markedUpUrl: null },
        ],
        mentioned_user_ids: ["user-2"],
        created_at: "2026-02-17T12:00:00Z",
        updated_at: null,
        deleted_at: null,
      };

      const note = mapRowToProjectNote(row);

      expect(note.id).toBe("uuid-1");
      expect(note.projectId).toBe("proj-1");
      expect(note.authorId).toBe("user-1");
      expect(note.content).toBe("Hello @[John](user-2)");
      expect(note.attachments).toHaveLength(1);
      expect(note.attachments[0].caption).toBe("Site photo");
      expect(note.mentionedUserIds).toEqual(["user-2"]);
      expect(note.createdAt).toBeInstanceOf(Date);
    });

    it("handles empty attachments and mentions", () => {
      const row = {
        id: "uuid-2",
        project_id: "proj-1",
        company_id: "comp-1",
        author_id: "user-1",
        content: "Simple note",
        attachments: [],
        mentioned_user_ids: [],
        created_at: "2026-02-17T12:00:00Z",
        updated_at: null,
        deleted_at: null,
      };

      const note = mapRowToProjectNote(row);

      expect(note.attachments).toEqual([]);
      expect(note.mentionedUserIds).toEqual([]);
    });

    it("handles null attachments and mentions from DB", () => {
      const row = {
        id: "uuid-3",
        project_id: "proj-1",
        company_id: "comp-1",
        author_id: "user-1",
        content: "Note with nulls",
        attachments: null,
        mentioned_user_ids: null,
        created_at: "2026-02-17T12:00:00Z",
        updated_at: "2026-02-17T13:00:00Z",
        deleted_at: null,
      };

      const note = mapRowToProjectNote(row);

      expect(note.attachments).toEqual([]);
      expect(note.mentionedUserIds).toEqual([]);
      expect(note.updatedAt).toBeInstanceOf(Date);
    });
  });
});
