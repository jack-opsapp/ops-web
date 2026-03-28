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
            color={author?.userColor ?? undefined}
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
