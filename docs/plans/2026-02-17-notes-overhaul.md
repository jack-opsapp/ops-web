# Notes Overhaul — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the plain-text notes field with a first-class threaded notes system — project-level only, with author attribution, @mentions with notifications, photo attachments with captions, and photo markup/annotation.

**Architecture:** Notes become a Supabase `project_notes` table (following the `activity_comments` pattern). Each note is authored, timestamped, and can contain @mentions (parsed from content) and photo attachments (with optional captions and markup). Photos attached to notes are cross-posted to the `project_photos` table so they appear in the Photos tab. Task-level notes UI is removed entirely. The legacy Bubble `teamNotes` field is migrated into the first note on each project.

**Tech Stack:** Next.js 15, TypeScript, Supabase (PostgreSQL), TanStack Query v5, Zustand, Radix UI, Tailwind CSS, Sonner (toasts), Vitest + Testing Library, S3 via Bubble presigned URLs, HTML5 Canvas (photo markup).

---

## Table of Contents

1. [Task 1: Supabase Migration — project_notes Table](#task-1)
2. [Task 2: Data Types — ProjectNote and NoteAttachment](#task-2)
3. [Task 3: Service Layer — ProjectNoteService](#task-3)
4. [Task 4: React Hooks — useProjectNotes](#task-4)
5. [Task 5: Remove Task Notes UI](#task-5)
6. [Task 6: NoteCard Component](#task-6)
7. [Task 7: NotesList Component](#task-7)
8. [Task 8: NoteComposer Component (Text Only)](#task-8)
9. [Task 9: Integrate Notes into Project Detail Page](#task-9)
10. [Task 10: Legacy Notes Migration](#task-10)
11. [Task 11: MentionTextArea Component](#task-11)
12. [Task 12: Wire MentionTextArea into NoteComposer](#task-12)
13. [Task 13: Photo Attachments in NoteComposer](#task-13)
14. [Task 14: Photo Caption Sheet](#task-14)
15. [Task 15: Cross-Post Note Photos to Project Gallery](#task-15)
16. [Task 16: Photo Markup — Canvas Annotation](#task-16)
17. [Task 17: Photo Markup — Toolbar and Controls](#task-17)
18. [Task 18: Wire Photo Markup into Note Flow](#task-18)
19. [Task 19: Notification Service — @Mention Alerts](#task-19)
20. [Task 20: Edit and Delete Notes](#task-20)

---

## Task 1: Supabase Migration — project_notes Table {#task-1}

**Files:**
- Create: `supabase/migrations/XXXXXX_create_project_notes.sql`

**Step 1: Write the migration SQL**

```sql
-- Create project_notes table
CREATE TABLE IF NOT EXISTS project_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  mentioned_user_ids TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

-- Index for fetching notes by project (most common query)
CREATE INDEX idx_project_notes_project_id
  ON project_notes (project_id)
  WHERE deleted_at IS NULL;

-- Index for finding notes that mention a specific user (for notifications)
CREATE INDEX idx_project_notes_mentions
  ON project_notes USING GIN (mentioned_user_ids)
  WHERE deleted_at IS NULL;

-- Index for company-scoped queries
CREATE INDEX idx_project_notes_company_id
  ON project_notes (company_id)
  WHERE deleted_at IS NULL;

-- RLS policies
ALTER TABLE project_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own company notes"
  ON project_notes FOR SELECT
  USING (true);

CREATE POLICY "Users can create notes"
  ON project_notes FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update own notes"
  ON project_notes FOR UPDATE
  USING (true);
```

**Step 2: Run the migration**

Run: `npx supabase migration up` (or apply via Supabase dashboard)
Expected: Table `project_notes` created with indexes and RLS policies.

**Step 3: Commit**

```bash
git add supabase/migrations/
git commit -m "feat: add project_notes table migration"
```

---

## Task 2: Data Types — ProjectNote and NoteAttachment {#task-2}

**Files:**
- Modify: `src/lib/types/pipeline.ts` (append to end)

**Step 1: Add the type definitions**

Append to `src/lib/types/pipeline.ts`:

```typescript
// --- Project Notes ---

export interface NoteAttachment {
  url: string;
  thumbnailUrl?: string | null;
  caption: string | null;
  markedUpUrl: string | null;
  width?: number;
  height?: number;
}

export interface ProjectNote {
  id: string;
  projectId: string;
  companyId: string;
  authorId: string;
  content: string;
  attachments: NoteAttachment[];
  mentionedUserIds: string[];
  createdAt: Date;
  updatedAt: Date | null;
  deletedAt: Date | null;
}

export type CreateProjectNote = {
  projectId: string;
  companyId: string;
  authorId: string;
  content: string;
  attachments?: NoteAttachment[];
  mentionedUserIds?: string[];
};

export type UpdateProjectNote = {
  id: string;
  content?: string;
  attachments?: NoteAttachment[];
  mentionedUserIds?: string[];
};
```

**Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No type errors.

**Step 3: Commit**

```bash
git add src/lib/types/pipeline.ts
git commit -m "feat: add ProjectNote and NoteAttachment types"
```

---

## Task 3: Service Layer — ProjectNoteService {#task-3}

**Files:**
- Create: `src/lib/api/services/project-note-service.ts`
- Create: `src/lib/api/services/__tests__/project-note-service.test.ts`

**Step 1: Write the failing test**

Create `src/lib/api/services/__tests__/project-note-service.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
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
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/api/services/__tests__/project-note-service.test.ts`
Expected: FAIL — cannot find `mapRowToProjectNote`.

**Step 3: Write the service**

Create `src/lib/api/services/project-note-service.ts`:

```typescript
import { requireSupabase } from "@/lib/supabase/helpers";
import type {
  ProjectNote,
  CreateProjectNote,
  UpdateProjectNote,
  NoteAttachment,
} from "@/lib/types/pipeline";

// --- Row Mapper ---

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
};

export function mapRowToProjectNote(row: ProjectNoteRow): ProjectNote {
  return {
    id: row.id,
    projectId: row.project_id,
    companyId: row.company_id,
    authorId: row.author_id,
    content: row.content,
    attachments: row.attachments ?? [],
    mentionedUserIds: row.mentioned_user_ids ?? [],
    createdAt: new Date(row.created_at),
    updatedAt: row.updated_at ? new Date(row.updated_at) : null,
    deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

// --- Service ---

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

    if (error) throw error;
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

    if (error) throw error;
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

    if (error) throw error;
    return mapRowToProjectNote(data);
  },

  async deleteNote(id: string): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("project_notes")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw error;
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

    if (error) throw error;
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
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/api/services/__tests__/project-note-service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/api/services/project-note-service.ts src/lib/api/services/__tests__/
git commit -m "feat: add ProjectNoteService with Supabase CRUD"
```

---

## Task 4: React Hooks — useProjectNotes {#task-4}

**Files:**
- Create: `src/lib/hooks/use-project-notes.ts`
- Modify: `src/lib/api/query-client.ts` (add query key)

**Step 1: Add query key**

In `src/lib/api/query-client.ts`, add to the `queryKeys` object:

```typescript
projectNotes: {
  all: ["projectNotes"] as const,
  byProject: (projectId: string) => ["projectNotes", projectId] as const,
},
```

**Step 2: Write the hooks file**

Create `src/lib/hooks/use-project-notes.ts`:

```typescript
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";
import { ProjectNoteService } from "@/lib/api/services/project-note-service";
import { useAuthStore } from "@/lib/store/auth-store";
import type { CreateProjectNote, UpdateProjectNote } from "@/lib/types/pipeline";

export function useProjectNotes(projectId: string | undefined) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.projectNotes.byProject(projectId ?? ""),
    queryFn: () =>
      ProjectNoteService.fetchNotes(projectId!, companyId),
    enabled: !!projectId && !!companyId,
  });
}

export function useCreateProjectNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateProjectNote) =>
      ProjectNoteService.createNote(input),
    onSuccess: (_result, input) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectNotes.byProject(input.projectId),
      });
    },
  });
}

export function useUpdateProjectNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateProjectNote & { projectId: string }) =>
      ProjectNoteService.updateNote(input),
    onSuccess: (_result, input) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectNotes.byProject(input.projectId),
      });
    },
  });
}

export function useDeleteProjectNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }: { id: string; projectId: string }) =>
      ProjectNoteService.deleteNote(id),
    onSuccess: (_result, { projectId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectNotes.byProject(projectId),
      });
    },
  });
}
```

**Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No type errors.

**Step 4: Commit**

```bash
git add src/lib/hooks/use-project-notes.ts src/lib/api/query-client.ts
git commit -m "feat: add useProjectNotes hooks with TanStack Query"
```

---

## Task 5: Remove Task Notes UI {#task-5}

**Files:**
- Modify: task detail and task form screens (search for `taskNotes`, `task_notes`, `"Task Notes"`)

**Step 1: Find all task notes UI references**

Search `src/` for: `taskNotes`, `task_notes`, `"Task Notes"`, `"Notes"` on task forms/details.

**Step 2: Remove task notes from task detail views**

Remove or comment out any notes section from task detail panels and task form screens. If task notes appear in a form, remove the textarea and its state. Leave the data model field intact (backward compatibility).

**Step 3: Verify no regressions**

Run: `npx tsc --noEmit`
Expected: No type errors (the field still exists on the type, just no UI references).

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: remove task-level notes UI (notes are project-only now)"
```

---

## Task 6: NoteCard Component {#task-6}

**Files:**
- Create: `src/components/ops/note-card.tsx`

**Step 1: Write the component**

```typescript
"use client";

import { formatDistanceToNow } from "date-fns";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { UserAvatar } from "@/components/ops/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ProjectNote } from "@/lib/types/pipeline";
import type { User } from "@/lib/types/models";

interface NoteCardProps {
  note: ProjectNote;
  author: User | undefined;
  currentUserId: string;
  onEdit?: (note: ProjectNote) => void;
  onDelete?: (noteId: string) => void;
  onPhotoClick?: (url: string) => void;
}

export function NoteCard({
  note,
  author,
  currentUserId,
  onEdit,
  onDelete,
  onPhotoClick,
}: NoteCardProps) {
  const isOwn = note.authorId === currentUserId;
  const displayName = author
    ? `${author.firstName} ${author.lastName}`
    : "Unknown User";
  const timeAgo = formatDistanceToNow(note.createdAt, { addSuffix: true });
  const wasEdited = note.updatedAt && note.updatedAt > note.createdAt;

  return (
    <div className="group rounded-lg border border-white/10 bg-white/[0.03] p-4">
      {/* Header: avatar + name + time + menu */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <UserAvatar
            name={displayName}
            imageUrl={author?.profileImageURL ?? null}
            size="sm"
            userColor={author?.userColor ?? null}
          />
          <div>
            <span className="text-sm font-medium text-[#E5E5E5]">
              {displayName}
            </span>
            <span className="ml-2 text-xs text-[#999]">
              {timeAgo}
              {wasEdited && " (edited)"}
            </span>
          </div>
        </div>

        {isOwn && (onEdit || onDelete) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded p-1 text-[#999] opacity-0 transition hover:bg-white/10 group-hover:opacity-100">
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onEdit && (
                <DropdownMenuItem onClick={() => onEdit(note)}>
                  <Pencil className="mr-2 h-3.5 w-3.5" />
                  Edit
                </DropdownMenuItem>
              )}
              {onDelete && (
                <DropdownMenuItem
                  onClick={() => onDelete(note.id)}
                  className="text-red-400"
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Content with rendered @mentions */}
      <div className="mt-2 text-sm text-[#E5E5E5] whitespace-pre-wrap">
        <NoteContent content={note.content} />
      </div>

      {/* Attachments (photos) */}
      {note.attachments.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {note.attachments.map((att, i) => (
            <button
              key={i}
              onClick={() => onPhotoClick?.(att.markedUpUrl ?? att.url)}
              className="group/photo relative overflow-hidden rounded-lg"
            >
              <img
                src={att.markedUpUrl ?? att.url}
                alt={att.caption ?? "Attached photo"}
                className="h-32 w-32 object-cover transition group-hover/photo:brightness-75"
              />
              {att.caption && (
                <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-2 py-1">
                  <span className="text-xs text-[#E5E5E5] line-clamp-2">
                    {att.caption}
                  </span>
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Mention Renderer ---

function NoteContent({ content }: { content: string }) {
  const mentionRegex = /@\[([^\]]+)\]\(([^)]+)\)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }
    parts.push(
      <span
        key={match.index}
        className="rounded bg-[#417394]/20 px-1 text-[#8BB8D4] font-medium"
      >
        @{match[1]}
      </span>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return <>{parts}</>;
}
```

**Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No type errors.

**Notes for implementer:** Check the exact prop names on `UserAvatar` before using. The props above (`name`, `imageUrl`, `size`, `userColor`) are based on the codebase analysis — adjust if the actual component differs.

**Step 3: Commit**

```bash
git add src/components/ops/note-card.tsx
git commit -m "feat: add NoteCard component with author, mentions, attachments"
```

---

## Task 7: NotesList Component {#task-7}

**Files:**
- Create: `src/components/ops/notes-list.tsx`

**Step 1: Write the component**

```typescript
"use client";

import { StickyNote } from "lucide-react";
import { NoteCard } from "@/components/ops/note-card";
import type { ProjectNote } from "@/lib/types/pipeline";
import type { User } from "@/lib/types/models";

interface NotesListProps {
  notes: ProjectNote[];
  users: User[];
  currentUserId: string;
  isLoading?: boolean;
  onEdit?: (note: ProjectNote) => void;
  onDelete?: (noteId: string) => void;
  onPhotoClick?: (url: string) => void;
}

export function NotesList({
  notes,
  users,
  currentUserId,
  isLoading,
  onEdit,
  onDelete,
  onPhotoClick,
}: NotesListProps) {
  const userMap = new Map(users.map((u) => [u.id, u]));

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-lg bg-white/5"
          />
        ))}
      </div>
    );
  }

  if (notes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <StickyNote className="mb-3 h-10 w-10 text-[#999]" />
        <p className="text-sm text-[#999]">No notes yet</p>
        <p className="mt-1 text-xs text-[#666]">
          Add a note to keep your team informed
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {notes.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          author={userMap.get(note.authorId)}
          currentUserId={currentUserId}
          onEdit={onEdit}
          onDelete={onDelete}
          onPhotoClick={onPhotoClick}
        />
      ))}
    </div>
  );
}
```

**Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No type errors.

**Step 3: Commit**

```bash
git add src/components/ops/notes-list.tsx
git commit -m "feat: add NotesList component with loading and empty states"
```

---

## Task 8: NoteComposer Component (Text Only) {#task-8}

**Files:**
- Create: `src/components/ops/note-composer.tsx`

**Step 1: Write the component (text-only first pass)**

```typescript
"use client";

import { Send } from "lucide-react";
import { useState, useRef } from "react";

interface NoteComposerProps {
  onSubmit: (content: string) => void;
  isSubmitting?: boolean;
  placeholder?: string;
}

export function NoteComposer({
  onSubmit,
  isSubmitting,
  placeholder = "Write a note...",
}: NoteComposerProps) {
  const [content, setContent] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSubmit = content.trim().length > 0 && !isSubmitting;

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmit(content.trim());
    setContent("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setContent(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <textarea
        ref={textareaRef}
        value={content}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={2}
        className="w-full resize-none bg-transparent text-sm text-[#E5E5E5] placeholder:text-[#666] focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-between">
        {/* Attachment buttons added in Task 13 */}
        <div />
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#666]">
            {content.length > 0 && "Ctrl+Enter to send"}
          </span>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex items-center gap-1.5 rounded-md bg-[#417394] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[#4d8ab0] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="h-3.5 w-3.5" />
            Post
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No type errors.

**Step 3: Commit**

```bash
git add src/components/ops/note-composer.tsx
git commit -m "feat: add NoteComposer component (text only)"
```

---

## Task 9: Integrate Notes into Project Detail Page {#task-9}

**Files:**
- Modify: `src/app/(dashboard)/projects/[id]/page.tsx`

**Step 1: Read the existing file**

Read the full project detail page to understand the current NotesTab and tab structure.

**Step 2: Replace the NotesTab function**

Replace the existing `NotesTab` (which just shows `project.notes` as plain text) with the threaded notes system:

```typescript
// Add imports at top
import { NotesList } from "@/components/ops/notes-list";
import { NoteComposer } from "@/components/ops/note-composer";
import {
  useProjectNotes,
  useCreateProjectNote,
  useDeleteProjectNote,
} from "@/lib/hooks/use-project-notes";
import { useAuthStore } from "@/lib/store/auth-store";
import { toast } from "sonner";

// Replace NotesTab function
function NotesTab({ project }: { project: Project }) {
  const { user, company } = useAuthStore();
  const { data: notes = [], isLoading } = useProjectNotes(project.id);
  const createNote = useCreateProjectNote();
  const deleteNote = useDeleteProjectNote();
  const users = project.teamMembers ?? [];

  function handleSubmit(content: string) {
    if (!user || !company) return;
    createNote.mutate(
      {
        projectId: project.id,
        companyId: company.id,
        authorId: user.id,
        content,
      },
      {
        onSuccess: () => toast.success("Note posted"),
        onError: () => toast.error("Failed to post note"),
      }
    );
  }

  function handleDelete(noteId: string) {
    deleteNote.mutate(
      { id: noteId, projectId: project.id },
      {
        onSuccess: () => toast.success("Note deleted"),
        onError: () => toast.error("Failed to delete note"),
      }
    );
  }

  return (
    <div className="space-y-4">
      <NoteComposer
        onSubmit={handleSubmit}
        isSubmitting={createNote.isPending}
      />
      <NotesList
        notes={notes}
        users={users}
        currentUserId={user?.id ?? ""}
        isLoading={isLoading}
        onDelete={handleDelete}
      />
    </div>
  );
}
```

**Step 3: Verify types compile and dev server renders**

Run: `npx tsc --noEmit`
Run: `npm run dev` and navigate to a project, click Notes tab.
Expected: Composer at top, empty state below.

**Step 4: Commit**

```bash
git add src/app/(dashboard)/projects/[id]/page.tsx
git commit -m "feat: replace plain-text notes tab with threaded notes system"
```

---

## Task 10: Legacy Notes Migration {#task-10}

**Files:**
- Modify: `src/app/(dashboard)/projects/[id]/page.tsx` (inside NotesTab)

**Step 1: Add migration logic to NotesTab**

Inside `NotesTab`, add a `useEffect` to migrate legacy `teamNotes` on first render:

```typescript
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";
import { ProjectNoteService } from "@/lib/api/services/project-note-service";

// Inside NotesTab, after hooks:
const queryClient = useQueryClient();
const migrated = useRef(false);

useEffect(() => {
  if (
    !migrated.current &&
    project.notes &&
    project.notes.trim() &&
    user &&
    company &&
    notes.length === 0 &&
    !isLoading
  ) {
    migrated.current = true;
    ProjectNoteService.migrateFromLegacy(
      project.id,
      company.id,
      project.notes,
      user.id
    ).then((result) => {
      if (result) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.projectNotes.byProject(project.id),
        });
      }
    });
  }
}, [project.notes, notes.length, isLoading, user, company]);
```

**Step 2: Verify migration works in dev**

Run: `npm run dev` and navigate to a project that has legacy `teamNotes` text.
Expected: First visit auto-creates a ProjectNote. Subsequent visits skip migration.

**Step 3: Commit**

```bash
git add src/app/(dashboard)/projects/[id]/page.tsx
git commit -m "feat: add one-time migration from legacy Bubble teamNotes to project_notes"
```

---

## Task 11: MentionTextArea Component {#task-11}

**Files:**
- Create: `src/components/ops/mention-textarea.tsx`
- Create: `src/components/ops/__tests__/mention-textarea.test.ts`

**Step 1: Write the failing test**

Create `src/components/ops/__tests__/mention-textarea.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseMentions, extractMentionedUserIds } from "../mention-textarea";

describe("mention parsing", () => {
  it("extracts user IDs from mention syntax", () => {
    const text =
      "Hey @[John Doe](user-1) and @[Jane Smith](user-2), check this out";
    const ids = extractMentionedUserIds(text);
    expect(ids).toEqual(["user-1", "user-2"]);
  });

  it("returns empty array for no mentions", () => {
    const ids = extractMentionedUserIds("Just a regular note");
    expect(ids).toEqual([]);
  });

  it("handles duplicate mentions", () => {
    const text = "@[John](user-1) said hi to @[John](user-1)";
    const ids = extractMentionedUserIds(text);
    expect(ids).toEqual(["user-1"]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ops/__tests__/mention-textarea.test.ts`
Expected: FAIL.

**Step 3: Write the component**

Create `src/components/ops/mention-textarea.tsx`:

```typescript
"use client";

import { useState, useRef, useCallback } from "react";
import { UserAvatar } from "@/components/ops/user-avatar";
import type { User } from "@/lib/types/models";

// --- Mention Parsing Utilities ---

const MENTION_PATTERN = /@\[([^\]]+)\]\(([^)]+)\)/g;

export function extractMentionedUserIds(text: string): string[] {
  const ids = new Set<string>();
  let match: RegExpExecArray | null;
  const regex = new RegExp(MENTION_PATTERN.source, "g");
  while ((match = regex.exec(text)) !== null) {
    ids.add(match[2]);
  }
  return Array.from(ids);
}

export function parseMentions(
  text: string
): Array<
  | { type: "text"; value: string }
  | { type: "mention"; name: string; userId: string }
> {
  const parts: Array<
    | { type: "text"; value: string }
    | { type: "mention"; name: string; userId: string }
  > = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const regex = new RegExp(MENTION_PATTERN.source, "g");

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: "mention", name: match[1], userId: match[2] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", value: text.slice(lastIndex) });
  }
  return parts;
}

// --- Component ---

interface MentionTextAreaProps {
  value: string;
  onChange: (value: string) => void;
  users: User[];
  placeholder?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export function MentionTextArea({
  value,
  onChange,
  users,
  placeholder,
  onKeyDown,
  textareaRef: externalRef,
}: MentionTextAreaProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionQuery, setSuggestionQuery] = useState("");
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [cursorPosition, setCursorPosition] = useState(0);
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const ref = externalRef ?? internalRef;

  const filteredUsers = users
    .filter((u) => {
      const name = `${u.firstName} ${u.lastName}`.toLowerCase();
      return name.includes(suggestionQuery.toLowerCase());
    })
    .slice(0, 5);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      const cursor = e.target.selectionStart ?? 0;
      onChange(newValue);
      setCursorPosition(cursor);

      // Auto-resize
      e.target.style.height = "auto";
      e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";

      // Check if we should show mention suggestions
      const textBeforeCursor = newValue.slice(0, cursor);
      const atIndex = textBeforeCursor.lastIndexOf("@");

      if (atIndex >= 0) {
        const charBefore =
          atIndex > 0 ? textBeforeCursor[atIndex - 1] : " ";
        const textAfterAt = textBeforeCursor.slice(atIndex + 1);
        if (
          (charBefore === " " || charBefore === "\n" || atIndex === 0) &&
          !textAfterAt.includes("\n") &&
          textAfterAt.length < 30
        ) {
          setSuggestionQuery(textAfterAt);
          setShowSuggestions(true);
          setSuggestionIndex(0);
          return;
        }
      }
      setShowSuggestions(false);
    },
    [onChange]
  );

  function insertMention(user: User) {
    const textBeforeCursor = value.slice(0, cursorPosition);
    const atIndex = textBeforeCursor.lastIndexOf("@");
    const textBefore = value.slice(0, atIndex);
    const textAfter = value.slice(cursorPosition);
    const mention = `@[${user.firstName} ${user.lastName}](${user.id})`;
    const newValue = textBefore + mention + " " + textAfter;
    onChange(newValue);
    setShowSuggestions(false);

    requestAnimationFrame(() => {
      if (ref.current) {
        const newCursor = textBefore.length + mention.length + 1;
        ref.current.focus();
        ref.current.setSelectionRange(newCursor, newCursor);
      }
    });
  }

  function handleKeyDownInternal(e: React.KeyboardEvent) {
    if (showSuggestions && filteredUsers.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSuggestionIndex((i) =>
          Math.min(i + 1, filteredUsers.length - 1)
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSuggestionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(filteredUsers[suggestionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowSuggestions(false);
        return;
      }
    }
    onKeyDown?.(e);
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDownInternal}
        placeholder={placeholder}
        rows={2}
        className="w-full resize-none bg-transparent text-sm text-[#E5E5E5] placeholder:text-[#666] focus:outline-none"
      />

      {showSuggestions && filteredUsers.length > 0 && (
        <div className="absolute bottom-full left-0 z-50 mb-1 w-64 rounded-lg border border-white/10 bg-[#1a1a1a] py-1 shadow-xl">
          {filteredUsers.map((user, i) => (
            <button
              key={user.id}
              onClick={() => insertMention(user)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
                i === suggestionIndex
                  ? "bg-[#417394]/20 text-[#E5E5E5]"
                  : "text-[#999] hover:bg-white/5"
              }`}
            >
              <UserAvatar
                name={`${user.firstName} ${user.lastName}`}
                imageUrl={user.profileImageURL ?? null}
                size="xs"
                userColor={user.userColor ?? null}
              />
              <span>
                {user.firstName} {user.lastName}
              </span>
              <span className="ml-auto text-xs text-[#666]">
                {user.role}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 4: Run tests**

Run: `npx vitest run src/components/ops/__tests__/mention-textarea.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/components/ops/mention-textarea.tsx src/components/ops/__tests__/
git commit -m "feat: add MentionTextArea with @mention autocomplete"
```

---

## Task 12: Wire MentionTextArea into NoteComposer {#task-12}

**Files:**
- Modify: `src/components/ops/note-composer.tsx`
- Modify: `src/app/(dashboard)/projects/[id]/page.tsx`

**Step 1: Update NoteComposer to use MentionTextArea**

Update the interface:

```typescript
import { MentionTextArea, extractMentionedUserIds } from "@/components/ops/mention-textarea";
import type { User } from "@/lib/types/models";

interface NoteComposerProps {
  onSubmit: (content: string, mentionedUserIds: string[]) => void;
  isSubmitting?: boolean;
  placeholder?: string;
  users: User[];
}
```

Replace the `<textarea>` with `<MentionTextArea>`:

```typescript
<MentionTextArea
  value={content}
  onChange={setContent}
  users={users}
  placeholder={placeholder}
  onKeyDown={handleKeyDown}
  textareaRef={textareaRef}
/>
```

Update `handleSubmit`:

```typescript
function handleSubmit() {
  if (!canSubmit) return;
  const trimmed = content.trim();
  const mentionedIds = extractMentionedUserIds(trimmed);
  onSubmit(trimmed, mentionedIds);
  setContent("");
}
```

**Step 2: Update NotesTab to pass users and handle mentionedUserIds**

```typescript
function handleSubmit(content: string, mentionedUserIds: string[]) {
  createNote.mutate({
    projectId: project.id,
    companyId: company.id,
    authorId: user.id,
    content,
    mentionedUserIds,
  }, { ... });
}

<NoteComposer
  onSubmit={handleSubmit}
  isSubmitting={createNote.isPending}
  users={users}
/>
```

**Step 3: Verify in dev**

Run: `npm run dev` — type `@` in composer.
Expected: User dropdown appears. Selecting inserts `@[Name](id)`.

**Step 4: Commit**

```bash
git add src/components/ops/note-composer.tsx src/app/(dashboard)/projects/[id]/page.tsx
git commit -m "feat: wire MentionTextArea into NoteComposer for @mentions"
```

---

## Task 13: Photo Attachments in NoteComposer {#task-13}

**Files:**
- Modify: `src/components/ops/note-composer.tsx`

**Step 1: Add photo picker and preview**

Add imports:

```typescript
import { Send, ImageIcon, X, Loader2 } from "lucide-react";
import { uploadImage } from "@/lib/api/services/image-service";
import { toast } from "sonner";
import type { NoteAttachment } from "@/lib/types/pipeline";
```

Update interface:

```typescript
interface NoteComposerProps {
  onSubmit: (
    content: string,
    mentionedUserIds: string[],
    attachments: NoteAttachment[]
  ) => void;
  isSubmitting?: boolean;
  placeholder?: string;
  users: User[];
}
```

Add state:

```typescript
const [attachments, setAttachments] = useState<NoteAttachment[]>([]);
const [uploadingCount, setUploadingCount] = useState(0);
const fileInputRef = useRef<HTMLInputElement>(null);
```

Add file handler:

```typescript
async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
  const files = Array.from(e.target.files ?? []);
  if (files.length === 0) return;

  setUploadingCount((c) => c + files.length);
  for (const file of files) {
    try {
      const url = await uploadImage(file);
      setAttachments((prev) => [
        ...prev,
        { url, caption: null, markedUpUrl: null },
      ]);
    } catch {
      toast.error(`Failed to upload ${file.name}`);
    } finally {
      setUploadingCount((c) => c - 1);
    }
  }
  e.target.value = "";
}
```

Update `canSubmit`:

```typescript
const canSubmit =
  (content.trim().length > 0 || attachments.length > 0) &&
  !isSubmitting &&
  uploadingCount === 0;
```

Update `handleSubmit`:

```typescript
function handleSubmit() {
  if (!canSubmit) return;
  const trimmed = content.trim();
  const mentionedIds = extractMentionedUserIds(trimmed);
  onSubmit(trimmed, mentionedIds, attachments);
  setContent("");
  setAttachments([]);
}
```

Add toolbar and preview UI (replace the `<div />` placeholder):

```typescript
<div className="flex items-center gap-1">
  <button
    type="button"
    onClick={() => fileInputRef.current?.click()}
    className="rounded p-1.5 text-[#999] transition hover:bg-white/10 hover:text-[#E5E5E5]"
    title="Attach photos"
  >
    <ImageIcon className="h-4 w-4" />
  </button>
  <input
    ref={fileInputRef}
    type="file"
    accept="image/jpeg,image/png,image/webp,image/heic"
    multiple
    className="hidden"
    onChange={handleFileSelect}
  />
</div>
```

Add attachment preview between textarea and toolbar:

```typescript
{(attachments.length > 0 || uploadingCount > 0) && (
  <div className="mt-2 flex flex-wrap gap-2">
    {attachments.map((att, i) => (
      <div key={i} className="group/att relative">
        <img
          src={att.markedUpUrl ?? att.url}
          alt={att.caption ?? "Attachment"}
          className="h-20 w-20 rounded-lg object-cover"
        />
        <button
          onClick={() =>
            setAttachments((prev) => prev.filter((_, j) => j !== i))
          }
          className="absolute -right-1.5 -top-1.5 rounded-full bg-red-500 p-0.5 text-white opacity-0 transition group-hover/att:opacity-100"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    ))}
    {uploadingCount > 0 && (
      <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-white/20">
        <Loader2 className="h-5 w-5 animate-spin text-[#999]" />
      </div>
    )}
  </div>
)}
```

**Step 2: Update NotesTab handleSubmit signature**

```typescript
function handleSubmit(
  content: string,
  mentionedUserIds: string[],
  attachments: NoteAttachment[]
) {
  createNote.mutate({
    projectId: project.id,
    companyId: company.id,
    authorId: user.id,
    content,
    mentionedUserIds,
    attachments,
  }, { ... });
}
```

**Step 3: Verify in dev**

Run: `npm run dev` — click photo icon, select images, see previews, post note.
Expected: Photos upload to S3, appear in composer, then display in posted note.

**Step 4: Commit**

```bash
git add src/components/ops/note-composer.tsx src/app/(dashboard)/projects/[id]/page.tsx
git commit -m "feat: add photo attachment support to NoteComposer"
```

---

## Task 14: Photo Caption Sheet {#task-14}

**Files:**
- Create: `src/components/ops/photo-caption-dialog.tsx`
- Modify: `src/components/ops/note-composer.tsx`

**Step 1: Write the caption dialog**

```typescript
"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface PhotoCaptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
  initialCaption: string | null;
  onSave: (caption: string | null) => void;
}

export function PhotoCaptionDialog({
  open,
  onOpenChange,
  imageUrl,
  initialCaption,
  onSave,
}: PhotoCaptionDialogProps) {
  const [caption, setCaption] = useState(initialCaption ?? "");

  function handleSave() {
    onSave(caption.trim() || null);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-white/10 bg-[#111]">
        <DialogHeader>
          <DialogTitle className="text-[#E5E5E5]">
            Photo Caption
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <img
            src={imageUrl}
            alt="Photo to caption"
            className="max-h-64 w-full rounded-lg object-contain"
          />
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Add a caption..."
            maxLength={200}
            rows={2}
            className="w-full resize-none rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-[#E5E5E5] placeholder:text-[#666] focus:border-[#417394] focus:outline-none"
          />
          <div className="text-right text-xs text-[#666]">
            {caption.length}/200
          </div>
        </div>

        <DialogFooter className="gap-2">
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-md px-3 py-1.5 text-sm text-[#999] hover:text-[#E5E5E5]"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="rounded-md bg-[#417394] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#4d8ab0]"
          >
            Save Caption
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Wire caption dialog into NoteComposer thumbnails**

In `note-composer.tsx`, add click-to-caption on each attachment thumbnail:

```typescript
import { PhotoCaptionDialog } from "./photo-caption-dialog";

const [captionTarget, setCaptionTarget] = useState<number | null>(null);

// Wrap each thumbnail in a clickable button:
<button onClick={() => setCaptionTarget(i)} className="group/att relative">
  {/* existing thumbnail img + remove button */}
  {att.caption && (
    <div className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-black/70 px-1 py-0.5">
      <span className="text-[10px] text-[#E5E5E5] line-clamp-1">
        {att.caption}
      </span>
    </div>
  )}
</button>

// After attachments preview area:
{captionTarget !== null && attachments[captionTarget] && (
  <PhotoCaptionDialog
    open={true}
    onOpenChange={() => setCaptionTarget(null)}
    imageUrl={attachments[captionTarget].url}
    initialCaption={attachments[captionTarget].caption}
    onSave={(caption) => {
      setAttachments((prev) =>
        prev.map((att, j) =>
          j === captionTarget ? { ...att, caption } : att
        )
      );
      setCaptionTarget(null);
    }}
  />
)}
```

**Step 3: Verify in dev**

Run: `npm run dev` — attach a photo, click thumbnail, add a caption.
Expected: Caption dialog opens, saves, displays on thumbnail.

**Step 4: Commit**

```bash
git add src/components/ops/photo-caption-dialog.tsx src/components/ops/note-composer.tsx
git commit -m "feat: add photo caption dialog for note attachments"
```

---

## Task 15: Cross-Post Note Photos to Project Gallery {#task-15}

**Files:**
- Modify: `src/app/(dashboard)/projects/[id]/page.tsx`

**Step 1: Import project photo hook**

```typescript
import { useCreateProjectPhoto } from "@/lib/hooks/use-project-photos";
```

**Step 2: Cross-post photos after note creation**

In `NotesTab`, after `createNote.mutate` succeeds:

```typescript
const createPhoto = useCreateProjectPhoto();

function handleSubmit(
  content: string,
  mentionedUserIds: string[],
  attachments: NoteAttachment[]
) {
  createNote.mutate(
    { projectId: project.id, companyId: company.id, authorId: user.id,
      content, mentionedUserIds, attachments },
    {
      onSuccess: () => {
        toast.success("Note posted");
        for (const att of attachments) {
          createPhoto.mutate({
            projectId: project.id,
            companyId: company.id,
            url: att.markedUpUrl ?? att.url,
            thumbnailUrl: null,
            source: "other" as const,
            siteVisitId: null,
            uploadedBy: user.id,
            takenAt: null,
            caption: att.caption,
          });
        }
      },
      onError: () => toast.error("Failed to post note"),
    }
  );
}
```

**Step 3: Verify in dev**

Run: `npm run dev` — post a note with photos, then switch to Photos tab.
Expected: Photos appear in the "Other" group in the project photo gallery.

**Step 4: Commit**

```bash
git add src/app/(dashboard)/projects/[id]/page.tsx
git commit -m "feat: cross-post note photos to project photo gallery"
```

---

## Task 16: Photo Markup — Canvas Annotation {#task-16}

**Files:**
- Create: `src/components/ops/photo-markup/markup-canvas.tsx`

**Step 1: Write the canvas component**

```typescript
"use client";

import {
  useRef,
  useEffect,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";

export interface DrawingPath {
  points: Array<{ x: number; y: number }>;
  color: string;
  width: number;
}

export interface MarkupCanvasRef {
  exportImage: () => string | null;
  undo: () => void;
  clear: () => void;
  hasDrawing: () => boolean;
}

interface MarkupCanvasProps {
  imageUrl: string;
  width?: number;
  height?: number;
  strokeColor?: string;
  strokeWidth?: number;
}

export const MarkupCanvas = forwardRef<MarkupCanvasRef, MarkupCanvasProps>(
  function MarkupCanvas(
    {
      imageUrl,
      width = 800,
      height = 600,
      strokeColor = "#FF0000",
      strokeWidth = 3,
    },
    ref
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [paths, setPaths] = useState<DrawingPath[]>([]);
    const [currentPath, setCurrentPath] = useState<DrawingPath | null>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const imageRef = useRef<HTMLImageElement | null>(null);
    const [dims, setDims] = useState({ w: width, h: height });

    // Load image
    useEffect(() => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        imageRef.current = img;
        const scale = Math.min(width / img.width, height / img.height);
        setDims({
          w: Math.round(img.width * scale),
          h: Math.round(img.height * scale),
        });
      };
      img.src = imageUrl;
    }, [imageUrl, width, height]);

    // Redraw
    const redraw = useCallback(
      (allPaths: DrawingPath[], active: DrawingPath | null) => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx || !imageRef.current) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(imageRef.current, 0, 0, canvas.width, canvas.height);

        const drawPath = (path: DrawingPath) => {
          if (path.points.length < 2) return;
          ctx.beginPath();
          ctx.strokeStyle = path.color;
          ctx.lineWidth = path.width;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.moveTo(path.points[0].x, path.points[0].y);
          for (let i = 1; i < path.points.length; i++) {
            ctx.lineTo(path.points[i].x, path.points[i].y);
          }
          ctx.stroke();
        };

        allPaths.forEach(drawPath);
        if (active) drawPath(active);
      },
      []
    );

    useEffect(() => {
      redraw(paths, currentPath);
    }, [paths, currentPath, redraw]);

    function getCanvasPoint(
      e: React.MouseEvent | React.TouchEvent
    ): { x: number; y: number } | null {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      if ("touches" in e) {
        const touch = e.touches[0];
        return {
          x: (touch.clientX - rect.left) * scaleX,
          y: (touch.clientY - rect.top) * scaleY,
        };
      }
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    }

    function handlePointerDown(e: React.MouseEvent | React.TouchEvent) {
      const point = getCanvasPoint(e);
      if (!point) return;
      setIsDrawing(true);
      setCurrentPath({ points: [point], color: strokeColor, width: strokeWidth });
    }

    function handlePointerMove(e: React.MouseEvent | React.TouchEvent) {
      if (!isDrawing || !currentPath) return;
      const point = getCanvasPoint(e);
      if (!point) return;
      setCurrentPath((prev) =>
        prev ? { ...prev, points: [...prev.points, point] } : null
      );
    }

    function handlePointerUp() {
      if (currentPath && currentPath.points.length > 1) {
        setPaths((prev) => [...prev, currentPath]);
      }
      setCurrentPath(null);
      setIsDrawing(false);
    }

    useImperativeHandle(ref, () => ({
      exportImage: () =>
        canvasRef.current?.toDataURL("image/jpeg", 0.9) ?? null,
      undo: () => setPaths((prev) => prev.slice(0, -1)),
      clear: () => setPaths([]),
      hasDrawing: () => paths.length > 0,
    }));

    return (
      <canvas
        ref={canvasRef}
        width={dims.w}
        height={dims.h}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onMouseLeave={handlePointerUp}
        onTouchStart={handlePointerDown}
        onTouchMove={handlePointerMove}
        onTouchEnd={handlePointerUp}
        className="max-w-full cursor-crosshair rounded-lg touch-none"
        style={{ aspectRatio: `${dims.w} / ${dims.h}` }}
      />
    );
  }
);
```

**Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No type errors.

**Step 3: Commit**

```bash
git add src/components/ops/photo-markup/markup-canvas.tsx
git commit -m "feat: add MarkupCanvas component for photo annotation"
```

---

## Task 17: Photo Markup — Toolbar and Controls {#task-17}

**Files:**
- Create: `src/components/ops/photo-markup/markup-toolbar.tsx`

**Step 1: Write the toolbar**

```typescript
"use client";

import { Undo, Eraser, Minus } from "lucide-react";

interface MarkupToolbarProps {
  color: string;
  onColorChange: (color: string) => void;
  strokeWidth: number;
  onStrokeWidthChange: (width: number) => void;
  onUndo: () => void;
  onClear: () => void;
  canUndo: boolean;
}

const COLORS = [
  "#FF0000",
  "#FFD700",
  "#00FF00",
  "#00BFFF",
  "#FF69B4",
  "#FFFFFF",
  "#000000",
];

const STROKE_WIDTHS = [
  { value: 2, label: "Thin" },
  { value: 4, label: "Medium" },
  { value: 8, label: "Thick" },
];

export function MarkupToolbar({
  color,
  onColorChange,
  strokeWidth,
  onStrokeWidthChange,
  onUndo,
  onClear,
  canUndo,
}: MarkupToolbarProps) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-white/10 bg-[#111] px-3 py-2">
      <div className="flex items-center gap-1.5">
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => onColorChange(c)}
            className={`h-6 w-6 rounded-full border-2 transition ${
              color === c ? "border-white scale-110" : "border-transparent"
            }`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>

      <div className="h-6 w-px bg-white/10" />

      <div className="flex items-center gap-1.5">
        {STROKE_WIDTHS.map((sw) => (
          <button
            key={sw.value}
            onClick={() => onStrokeWidthChange(sw.value)}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition ${
              strokeWidth === sw.value
                ? "bg-[#417394]/30 text-[#8BB8D4]"
                : "text-[#999] hover:text-[#E5E5E5]"
            }`}
          >
            <Minus
              className="h-3 w-3"
              style={{ strokeWidth: sw.value }}
            />
            {sw.label}
          </button>
        ))}
      </div>

      <div className="h-6 w-px bg-white/10" />

      <button
        onClick={onUndo}
        disabled={!canUndo}
        className="rounded p-1.5 text-[#999] transition hover:bg-white/10 hover:text-[#E5E5E5] disabled:opacity-30"
        title="Undo"
      >
        <Undo className="h-4 w-4" />
      </button>
      <button
        onClick={onClear}
        disabled={!canUndo}
        className="rounded p-1.5 text-[#999] transition hover:bg-white/10 hover:text-[#E5E5E5] disabled:opacity-30"
        title="Clear all"
      >
        <Eraser className="h-4 w-4" />
      </button>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/ops/photo-markup/markup-toolbar.tsx
git commit -m "feat: add MarkupToolbar with color/width picker and undo/clear"
```

---

## Task 18: Wire Photo Markup into Note Flow {#task-18}

**Files:**
- Create: `src/components/ops/photo-markup/photo-markup-dialog.tsx`
- Modify: `src/components/ops/note-composer.tsx`

**Step 1: Write the markup dialog**

```typescript
"use client";

import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { MarkupCanvas, type MarkupCanvasRef } from "./markup-canvas";
import { MarkupToolbar } from "./markup-toolbar";
import { uploadImage } from "@/lib/api/services/image-service";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface PhotoMarkupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
  onSave: (markedUpUrl: string) => void;
}

export function PhotoMarkupDialog({
  open,
  onOpenChange,
  imageUrl,
  onSave,
}: PhotoMarkupDialogProps) {
  const canvasRef = useRef<MarkupCanvasRef>(null);
  const [color, setColor] = useState("#FF0000");
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [isSaving, setIsSaving] = useState(false);
  const [pathCount, setPathCount] = useState(0);

  async function handleSave() {
    if (!canvasRef.current) return;

    const dataUrl = canvasRef.current.exportImage();
    if (!dataUrl) return;

    setIsSaving(true);
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], "markup.jpg", { type: "image/jpeg" });
      const url = await uploadImage(file);
      onSave(url);
      onOpenChange(false);
    } catch {
      toast.error("Failed to save markup");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl border-white/10 bg-[#111]">
        <DialogHeader>
          <DialogTitle className="text-[#E5E5E5]">
            Mark Up Photo
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <MarkupToolbar
            color={color}
            onColorChange={setColor}
            strokeWidth={strokeWidth}
            onStrokeWidthChange={setStrokeWidth}
            onUndo={() => {
              canvasRef.current?.undo();
              setPathCount((c) => Math.max(0, c - 1));
            }}
            onClear={() => {
              canvasRef.current?.clear();
              setPathCount(0);
            }}
            canUndo={pathCount > 0}
          />

          <div className="flex justify-center">
            <MarkupCanvas
              ref={canvasRef}
              imageUrl={imageUrl}
              width={700}
              height={500}
              strokeColor={color}
              strokeWidth={strokeWidth}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-md px-3 py-1.5 text-sm text-[#999] hover:text-[#E5E5E5]"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-1.5 rounded-md bg-[#417394] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#4d8ab0] disabled:opacity-50"
          >
            {isSaving && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            Save Markup
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Add markup trigger to NoteComposer thumbnails**

In `note-composer.tsx`, add a pencil-icon overlay on each attachment thumbnail:

```typescript
import { Pencil } from "lucide-react";
import { PhotoMarkupDialog } from "./photo-markup/photo-markup-dialog";

const [markupTarget, setMarkupTarget] = useState<number | null>(null);

// On each thumbnail, add markup button:
<button
  onClick={(e) => {
    e.stopPropagation();
    setMarkupTarget(i);
  }}
  className="absolute bottom-1 left-1 rounded bg-black/60 p-1 text-white opacity-0 transition group-hover/att:opacity-100"
  title="Mark up photo"
>
  <Pencil className="h-3 w-3" />
</button>

// After caption dialog:
{markupTarget !== null && attachments[markupTarget] && (
  <PhotoMarkupDialog
    open={true}
    onOpenChange={() => setMarkupTarget(null)}
    imageUrl={attachments[markupTarget].url}
    onSave={(markedUpUrl) => {
      setAttachments((prev) =>
        prev.map((att, j) =>
          j === markupTarget ? { ...att, markedUpUrl } : att
        )
      );
      setMarkupTarget(null);
    }}
  />
)}
```

**Step 3: Verify in dev**

Run: `npm run dev` — attach photo, hover thumbnail, click pencil icon.
Expected: Markup dialog opens. Draw on photo. Save uploads annotated version.

**Step 4: Commit**

```bash
git add src/components/ops/photo-markup/ src/components/ops/note-composer.tsx
git commit -m "feat: add photo markup dialog with canvas annotation"
```

---

## Task 19: Notification Service — @Mention Alerts {#task-19}

**Files:**
- Create: `supabase/migrations/XXXXXX_create_notifications.sql`
- Create: `src/lib/api/services/notification-service.ts`
- Modify: `src/app/(dashboard)/projects/[id]/page.tsx`

**Step 1: Write the notifications migration**

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'mention',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  project_id TEXT,
  note_id TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_unread
  ON notifications (user_id, company_id)
  WHERE is_read = false;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own notifications"
  ON notifications FOR SELECT USING (true);

CREATE POLICY "Users can create notifications"
  ON notifications FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE USING (true);
```

**Step 2: Write the notification service**

Create `src/lib/api/services/notification-service.ts`:

```typescript
import { requireSupabase } from "@/lib/supabase/helpers";

export interface AppNotification {
  id: string;
  userId: string;
  companyId: string;
  type: "mention";
  title: string;
  body: string;
  projectId: string | null;
  noteId: string | null;
  isRead: boolean;
  createdAt: Date;
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
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) throw error;
    return (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      userId: row.user_id as string,
      companyId: row.company_id as string,
      type: row.type as "mention",
      title: row.title as string,
      body: row.body as string,
      projectId: row.project_id as string | null,
      noteId: row.note_id as string | null,
      isRead: row.is_read as boolean,
      createdAt: new Date(row.created_at as string),
    }));
  },

  async markAsRead(notificationId: string): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", notificationId);
    if (error) throw error;
  },
};
```

**Step 3: Fire notifications on note creation**

In `NotesTab` `handleSubmit`, update the `onSuccess` callback:

```typescript
onSuccess: (result) => {
  toast.success("Note posted");

  // Cross-post photos
  for (const att of attachments) {
    createPhoto.mutate({ ... });
  }

  // Send mention notifications
  if (mentionedUserIds.length > 0 && user) {
    NotificationService.createMentionNotifications({
      mentionedUserIds,
      authorName: `${user.firstName} ${user.lastName}`,
      projectId: project.id,
      projectTitle: project.title,
      noteId: result.id,
      companyId: company.id,
    });
  }
},
```

**Step 4: Commit**

```bash
git add supabase/migrations/ src/lib/api/services/notification-service.ts src/app/(dashboard)/projects/[id]/page.tsx
git commit -m "feat: add notification service and @mention alerts"
```

---

## Task 20: Edit and Delete Notes {#task-20}

**Files:**
- Modify: `src/app/(dashboard)/projects/[id]/page.tsx`
- Modify: `src/components/ops/note-composer.tsx`

**Step 1: Add edit state to NotesTab**

```typescript
const [editingNote, setEditingNote] = useState<ProjectNote | null>(null);
const updateNote = useUpdateProjectNote();

function handleEdit(note: ProjectNote) {
  setEditingNote(note);
}

function handleCancelEdit() {
  setEditingNote(null);
}

function handleUpdate(
  content: string,
  mentionedUserIds: string[],
  attachments: NoteAttachment[]
) {
  if (!editingNote) return;
  updateNote.mutate(
    {
      id: editingNote.id,
      projectId: project.id,
      content,
      mentionedUserIds,
      attachments,
    },
    {
      onSuccess: () => {
        toast.success("Note updated");
        setEditingNote(null);
      },
      onError: () => toast.error("Failed to update note"),
    }
  );
}
```

**Step 2: Add confirm dialog for delete**

```typescript
import { ConfirmDialog } from "@/components/ops/confirm-dialog";

const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

function handleDeleteConfirm() {
  if (!deleteTarget) return;
  deleteNote.mutate(
    { id: deleteTarget, projectId: project.id },
    {
      onSuccess: () => {
        toast.success("Note deleted");
        setDeleteTarget(null);
      },
    }
  );
}

// In JSX:
<ConfirmDialog
  open={!!deleteTarget}
  onOpenChange={() => setDeleteTarget(null)}
  title="Delete Note"
  description="Are you sure you want to delete this note? This cannot be undone."
  onConfirm={handleDeleteConfirm}
  confirmLabel="Delete"
  variant="destructive"
/>
```

**Step 3: Add initialContent, initialAttachments, onCancel props to NoteComposer**

Update interface:

```typescript
interface NoteComposerProps {
  onSubmit: (
    content: string,
    mentionedUserIds: string[],
    attachments: NoteAttachment[]
  ) => void;
  isSubmitting?: boolean;
  placeholder?: string;
  users: User[];
  initialContent?: string;
  initialAttachments?: NoteAttachment[];
  onCancel?: () => void;
}
```

Initialize from props:

```typescript
const [content, setContent] = useState(initialContent ?? "");
const [attachments, setAttachments] = useState<NoteAttachment[]>(
  initialAttachments ?? []
);
```

Show Cancel/Save buttons when editing:

```typescript
{onCancel && (
  <button
    onClick={onCancel}
    className="rounded-md px-3 py-1.5 text-xs text-[#999] hover:text-[#E5E5E5]"
  >
    Cancel
  </button>
)}
<button onClick={handleSubmit} disabled={!canSubmit} className="...">
  <Send className="h-3.5 w-3.5" />
  {onCancel ? "Save" : "Post"}
</button>
```

**Step 4: Wire edit composer into NotesTab**

```typescript
{editingNote ? (
  <NoteComposer
    onSubmit={handleUpdate}
    isSubmitting={updateNote.isPending}
    users={users}
    initialContent={editingNote.content}
    initialAttachments={editingNote.attachments}
    onCancel={handleCancelEdit}
  />
) : (
  <NoteComposer
    onSubmit={handleSubmit}
    isSubmitting={createNote.isPending}
    users={users}
  />
)}

<NotesList
  notes={notes}
  users={users}
  currentUserId={user?.id ?? ""}
  isLoading={isLoading}
  onEdit={handleEdit}
  onDelete={(id) => setDeleteTarget(id)}
/>
```

**Step 5: Verify in dev**

Run: `npm run dev` — post a note, click three-dot menu, edit it, delete it.
Expected: Edit opens pre-filled composer. Save updates note. Delete shows confirm and soft-deletes.

**Step 6: Commit**

```bash
git add src/components/ops/note-composer.tsx src/app/(dashboard)/projects/[id]/page.tsx
git commit -m "feat: add edit and delete for project notes"
```

---

## Summary of Files Created/Modified

### New Files (15)

| File | Purpose |
|------|---------|
| `supabase/migrations/XXXXXX_create_project_notes.sql` | DB migration |
| `supabase/migrations/XXXXXX_create_notifications.sql` | DB migration |
| `src/lib/api/services/project-note-service.ts` | Supabase CRUD for notes |
| `src/lib/api/services/notification-service.ts` | Mention notifications |
| `src/lib/api/services/__tests__/project-note-service.test.ts` | Service tests |
| `src/lib/hooks/use-project-notes.ts` | TanStack Query hooks |
| `src/components/ops/note-card.tsx` | Single note display |
| `src/components/ops/notes-list.tsx` | Notes feed w/ empty/loading states |
| `src/components/ops/note-composer.tsx` | Note creation/editing |
| `src/components/ops/mention-textarea.tsx` | @mention text input |
| `src/components/ops/photo-caption-dialog.tsx` | Photo caption editor |
| `src/components/ops/photo-markup/markup-canvas.tsx` | HTML5 Canvas annotation |
| `src/components/ops/photo-markup/markup-toolbar.tsx` | Drawing tools UI |
| `src/components/ops/photo-markup/photo-markup-dialog.tsx` | Markup dialog wrapper |
| `src/components/ops/__tests__/mention-textarea.test.ts` | Mention parsing tests |

### Modified Files (3)

| File | Change |
|------|--------|
| `src/lib/types/pipeline.ts` | Add ProjectNote, NoteAttachment, Create/Update types |
| `src/lib/api/query-client.ts` | Add projectNotes query key |
| `src/app/(dashboard)/projects/[id]/page.tsx` | Replace NotesTab, remove task notes, add migration |
