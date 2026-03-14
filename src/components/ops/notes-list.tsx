"use client";

import { useState, useMemo } from "react";
import { StickyNote } from "lucide-react";
import { NoteCard } from "@/components/ops/note-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDictionary } from "@/i18n/client";
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
  const { t } = useDictionary("projects");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [searchQuery, setSearchQuery] = useState("");

  const userMap = new Map(users.map((u) => [u.id, u]));

  const filteredNotes = useMemo(() => {
    let result = [...notes];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((n) => n.content.toLowerCase().includes(q));
    }
    result.sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return sortOrder === "newest" ? dateB - dateA : dateA - dateB;
    });
    return result;
  }, [notes, searchQuery, sortOrder]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-[3px] bg-white/5"
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
    <div>
      {/* Sort / Search toolbar */}
      <div className="flex items-center justify-between mb-4">
        <Select
          value={sortOrder}
          onValueChange={(v) => setSortOrder(v as "newest" | "oldest")}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">
              {t("notesFeed.sortNewest")}
            </SelectItem>
            <SelectItem value="oldest">
              {t("notesFeed.sortOldest")}
            </SelectItem>
          </SelectContent>
        </Select>
        <input
          type="text"
          placeholder={t("notesFeed.searchPlaceholder")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="font-mohave text-body-sm bg-background-card border border-border rounded-[3px] px-3 py-1.5 text-text-primary placeholder:text-text-disabled w-[200px] outline-none focus:border-[rgba(255,255,255,0.3)]"
        />
      </div>

      {/* Notes feed */}
      <div className="space-y-3">
        {filteredNotes.map((note) => (
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
    </div>
  );
}
