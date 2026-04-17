"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { InboxConversation } from "@/lib/types/unified-inbox";

interface ConversationItemProps {
  conversation: InboxConversation;
  isActive: boolean;
  hasAutoDraft?: boolean;
  onClick: () => void;
}

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ConversationItem({
  conversation,
  isActive,
  hasAutoDraft,
  onClick,
}: ConversationItemProps) {
  const isUnmatched = conversation.type === "unmatched";
  const hasUnread = conversation.unreadCount > 0;

  const channelBadge = conversation.lastMessageChannel === "portal"
    ? { label: "PORTAL", variant: "neutral" as const }
    : isUnmatched
      ? { label: "UNMATCHED", variant: "tan" as const }
      : { label: "EMAIL", variant: "neutral" as const };

  return (
    <button
      onClick={onClick}
      className={cn(
        "relative w-full text-left px-2.5 py-2.5 rounded-[6px] cursor-pointer transition-colors duration-150",
        isActive
          ? "bg-[rgba(255,255,255,0.04)]"
          : "hover:bg-[rgba(255,255,255,0.04)]",
        !hasUnread && !isActive && "opacity-60"
      )}
    >
      {/* Active indicator — 2px text-2 bar (unified selection pattern) */}
      {isActive && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-[8px] bottom-[8px] w-[2px] bg-text-2 rounded-[1px]"
        />
      )}
      <div className="flex items-start gap-1.5">
        {/* Avatar */}
        <div
          className={cn(
            "w-[28px] h-[28px] rounded-full flex items-center justify-center shrink-0",
            "font-mono text-caption-sm font-semibold",
            isUnmatched
              ? "bg-ops-amber-muted text-ops-amber"
              : isActive
                ? "bg-[rgba(255,255,255,0.08)] text-text"
                : "bg-surface-input text-text-mute"
          )}
        >
          {conversation.avatarInitials}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span
              className={cn(
                "font-mohave text-body-sm truncate",
                isUnmatched ? "italic text-text-3" : isActive ? "text-text" : "text-text-2",
                hasUnread && "font-semibold text-text"
              )}
            >
              {conversation.displayName}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              {hasAutoDraft && (
                <Sparkles className="w-[14px] h-[14px] text-text-2" />
              )}
              <span className="font-mono text-micro text-text-mute">
                {formatRelativeTime(conversation.lastMessageAt)}
              </span>
              {hasUnread && (
                <span className="inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full bg-fill-neutral text-text font-mono text-micro leading-none">
                  {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
                </span>
              )}
            </div>
          </div>

          {/* Project name */}
          {conversation.projectName && (
            <span className="font-mono text-micro text-text-mute uppercase block mt-0.5 truncate">
              {conversation.projectName}
            </span>
          )}

          {/* Preview */}
          <div className="flex items-center gap-1.5 mt-1">
            <span
              className={cn(
                "px-1.5 py-0.5 rounded-chip font-mono text-micro shrink-0 border",
                channelBadge.variant === "tan"
                  ? "bg-ops-amber-muted text-ops-amber border-[rgba(196,168,104,0.28)]"
                  : "bg-[rgba(255,255,255,0.05)] text-text-2 border-[rgba(255,255,255,0.10)]"
              )}
            >
              {channelBadge.label}
            </span>
            <span className="font-mohave text-caption-sm text-text-3 truncate">
              {conversation.lastMessagePreview}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
