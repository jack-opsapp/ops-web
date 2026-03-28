"use client";

/**
 * OPS Web - Activity Comment
 *
 * Renders threaded comments below an activity entry.
 * Includes inline add-comment textarea (Enter to submit).
 */

import { useState, useRef, useCallback } from "react";
import { Trash2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  useActivityComments,
  useCreateActivityComment,
  useDeleteActivityComment,
} from "@/lib/hooks/use-activity-comments";
import { useAuthStore } from "@/lib/store/auth-store";
import type { ActivityComment } from "@/lib/types/pipeline";

// ─── Single Comment ───────────────────────────────────────────────────────────

function CommentBubble({
  comment,
  isOwnComment,
  onDelete,
}: {
  comment: ActivityComment;
  isOwnComment: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="group flex items-start gap-2">
      <div className="h-6 w-6 rounded-full bg-[#2A2A2A] flex items-center justify-center text-[#9CA3AF] text-xs shrink-0 mt-0.5">
        {comment.userId.slice(0, 1).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className={cn(
          "inline-block px-3 py-2 rounded-xl text-sm max-w-full break-words",
          comment.isClientVisible
            ? "bg-[#1A2A1A] text-[#E5E5E5]"
            : "bg-[#1A1A1A] text-[#E5E5E5]"
        )}>
          {comment.content}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-[#555]">
            {comment.createdAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          {comment.isClientVisible && (
            <span className="text-xs text-[#9DB582]">visible to client</span>
          )}
          {isOwnComment && (
            <button
              onClick={onDelete}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-[#555] hover:text-[#93321A]"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Add Comment Input ────────────────────────────────────────────────────────

function AddCommentInput({
  activityId,
  companyId,
  userId,
}: {
  activityId: string;
  companyId: string;
  userId: string;
}) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const createComment = useCreateActivityComment();

  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const content = value.trim();
        if (!content) return;

        setValue("");
        try {
          await createComment.mutateAsync({
            activityId,
            companyId,
            userId,
            content,
            isClientVisible: false,
          });
        } catch {
          setValue(content); // restore on error
        }
      }
    },
    [value, activityId, companyId, userId, createComment]
  );

  return (
    <div className={cn(
      "flex items-start gap-2 transition-opacity",
      focused ? "opacity-100" : "opacity-60 hover:opacity-80"
    )}>
      <div className="h-6 w-6 rounded-full bg-[#417394]/20 flex items-center justify-center text-[#417394] text-xs shrink-0 mt-0.5">
        {userId.slice(0, 1).toUpperCase()}
      </div>
      <div className="flex-1 relative">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Add comment… (Enter to submit)"
          rows={1}
          className="w-full bg-[#111] border border-[#2A2A2A] rounded-xl px-3 py-2 text-sm text-[#E5E5E5] placeholder-[#555] resize-none outline-none focus:border-[#417394]/50 transition-colors"
        />
        {createComment.isPending && (
          <Loader2 className="absolute right-2 top-2 h-3.5 w-3.5 animate-spin text-[#417394]" />
        )}
      </div>
    </div>
  );
}

// ─── ActivityCommentSection ────────────────────────────────────────────────────

export interface ActivityCommentSectionProps {
  activityId: string;
  companyId: string;
  defaultCollapsed?: boolean;
}

export function ActivityCommentSection({
  activityId,
  companyId,
  defaultCollapsed = false,
}: ActivityCommentSectionProps) {
  const { currentUser: user } = useAuthStore();
  const { data: comments = [], isLoading } = useActivityComments(activityId);
  const deleteComment = useDeleteActivityComment();
  const [expanded, setExpanded] = useState(!defaultCollapsed);

  if (!user) return null;

  const handleDelete = (commentId: string) => {
    deleteComment.mutate({ id: commentId, activityId });
  };

  return (
    <div className="pl-8 mt-2 space-y-2">
      {comments.length > 0 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-[#555] hover:text-[#9CA3AF] transition-colors"
        >
          {expanded ? "Hide" : `${comments.length} comment${comments.length !== 1 ? "s" : ""}`}
        </button>
      )}

      {expanded && !isLoading && (
        <div className="space-y-2">
          {comments.map((comment) => (
            <CommentBubble
              key={comment.id}
              comment={comment}
              isOwnComment={comment.userId === user.id}
              onDelete={() => handleDelete(comment.id)}
            />
          ))}
        </div>
      )}

      <AddCommentInput
        activityId={activityId}
        companyId={companyId}
        userId={user.id}
      />
    </div>
  );
}
