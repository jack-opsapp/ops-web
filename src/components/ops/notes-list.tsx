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
